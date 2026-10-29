using System.Text.Json;
using System.Text.Json.Nodes;
using FormPlatform.Api.Core;
using FormPlatform.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace FormPlatform.Api.Modules;

[ApiController, Authorize, Route("api")]
public sealed class ReportingController(PlatformDb db, Access access) : ControllerBase
{
    [HttpGet("studies/{studyId:guid}/progress")]
    public async Task<object> Progress(Guid studyId)
    {
        var sites = await access.Sites(studyId, Permission.Read);
        var rows = await (from subject in db.Subjects
            where subject.StudyId == studyId && sites.Contains(subject.SiteId)
            join visit in db.Visits on subject.Id equals visit.SubjectId
            select new { subjectId = subject.Id, subject.Code, subject.SiteId, visitId = visit.Id, visit.Name, visit.Date }).ToListAsync();
        var result = new List<object>();
        var adoptions = await db.Adoptions.Where(x => x.StudyId == studyId && x.Active).ToListAsync();
        foreach (var row in rows)
        {
            var visit = await db.Visits.FindAsync(row.visitId);
            foreach (var adoption in adoptions.Where(x => x.VisitDefinitionId == null || x.VisitDefinitionId == visit!.DefinitionId))
            {
                var occurrences = await db.Occurrences.Where(x => x.SubjectVisitId == row.visitId && x.AdoptionId == adoption.Id).ToListAsync();
                var ids = occurrences.Select(x => x.Id).ToArray();
                var responses = await db.Responses.Where(x => ids.Contains(x.OccurrenceId)).Select(x => new { x.Id, x.State, x.Revision }).ToListAsync();
                var version = await db.Versions.FindAsync(adoption.FormVersionId);
                var template = await db.Templates.FindAsync(version!.TemplateId);
                result.Add(new { row.subjectId, subjectCode = row.Code, row.SiteId, row.visitId, visitName = row.Name, row.Date,
                    adoptionId = adoption.Id, formName = template!.Name, version = version.Version, expectedMinimum = 1,
                    started = responses.Count, submitted = responses.Count(x => x.State is "submitted" or "reviewed" or "locked"),
                    notDone = occurrences.Count(x => x.NotDoneReason != null), missing = responses.Count == 0 && occurrences.All(x => x.NotDoneReason == null), responses });
            }
        }
        return result;
    }
    public record NotDoneInput(long ExpectedRevision, string Reason);
    [HttpPost("occurrences/{id:guid}/not-done")]
    public async Task<object> NotDone(Guid id, NotDoneInput input)
    {
        var occurrence = await db.Occurrences.FindAsync(id) ?? throw PlatformError.Missing();
        var visit = await db.Visits.FindAsync(occurrence.SubjectVisitId) ?? throw PlatformError.Missing();
        var subject = await access.Subject(visit.SubjectId, Permission.Collect); var actor = await access.Actor();
        PlatformError.Revision(input.ExpectedRevision, occurrence.Revision);
        PlatformError.Check(!await db.Responses.AnyAsync(x => x.OccurrenceId == id), "RESPONSE_EXISTS", "已有填答，不能改標為未執行。");
        occurrence.NotDoneReason = PlatformError.Text(input.Reason, "未執行理由", 2000);
        access.Evidence(subject.StudyId, subject.SiteId, actor.Id, "occurrence.not-done", id, occurrence.NotDoneReason); await db.SaveChangesAsync(); return occurrence;
    }
    [HttpPost("occurrences/{id:guid}/resume")]
    public async Task<object> Resume(Guid id, NotDoneInput input)
    {
        var occurrence = await db.Occurrences.FindAsync(id) ?? throw PlatformError.Missing();
        var visit = await db.Visits.FindAsync(occurrence.SubjectVisitId) ?? throw PlatformError.Missing();
        var subject = await access.Subject(visit.SubjectId, Permission.Collect); var actor = await access.Actor();
        PlatformError.Revision(input.ExpectedRevision, occurrence.Revision);
        PlatformError.Check(occurrence.NotDoneReason != null, "INVALID_STATE", "只有未執行表單可以恢復。");
        await access.CollectionAllowed(subject);
        var adoption = await db.Adoptions.FindAsync(occurrence.AdoptionId) ?? throw PlatformError.Missing();
        PlatformError.Check(adoption.Active, "OCCURRENCE_INACTIVE", "採用版本已停用，無法恢復收集。");
        var reason = PlatformError.Text(input.Reason, "恢復收集理由", 2000);
        occurrence.NotDoneReason = null;
        access.Evidence(subject.StudyId, subject.SiteId, actor.Id, "occurrence.resumed", id, reason);
        await db.SaveChangesAsync(); return occurrence;
    }
    public record ExportInput(string Purpose, string Reason);
    [HttpPost("studies/{studyId:guid}/exports")]
    public async Task<object> Export(Guid studyId, ExportInput input)
    {
        var actor = await access.Actor(); var sites = (await access.Sites(studyId, Permission.Export)).Intersect(await access.Sites(studyId, Permission.Read)).ToArray();
        if (sites.Length == 0) throw PlatformError.Missing();
        var purpose = PlatformError.Text(input.Purpose, "匯出用途", 80); var reason = PlatformError.Text(input.Reason, "匯出理由", 2000);
        var rows = await (from subject in db.Subjects where subject.StudyId == studyId && sites.Contains(subject.SiteId)
            join visit in db.Visits on subject.Id equals visit.SubjectId
            join occurrence in db.Occurrences on visit.Id equals occurrence.SubjectVisitId
            join response in db.Responses on occurrence.Id equals response.OccurrenceId
            where response.State == "submitted" || response.State == "reviewed" || response.State == "locked"
            select new { subject, visit, occurrence, response }).OrderBy(x => x.response.Id).Take(1001).ToListAsync();
        PlatformError.Check(rows.Count <= 1000, "EXPORT_SCOPE_TOO_LARGE", "目前單次匯出上限 1000 筆，請縮小研究範圍或改用後續批次匯出工作。");
        var payloadRows = new List<object>();
        foreach (var row in rows)
        {
            await access.CollectionAllowed(row.subject, purpose);
            var version = await db.Versions.FindAsync(row.response.FormVersionId) ?? throw PlatformError.Missing();
            payloadRows.Add(new { subjectId = row.subject.Id, subjectCode = row.subject.Code, row.subject.SiteId,
                visitId = row.visit.Id, visitName = row.visit.Name, row.visit.Date, occurrenceNumber = row.occurrence.Number,
                responseId = row.response.Id, revision = row.response.Revision, state = row.response.State,
                formVersionId = version.Id, version = version.Version, contractHash = version.ContentHash,
                data = JsonNode.Parse(row.response.DataJson), coding = JsonNode.Parse(version.ContractJson)!["x-airwayai"]!["fields"] });
        }
        var export = new ExportSnapshot { StudyId = studyId, RequestedBy = actor.Id, Purpose = purpose, Reason = reason,
            SiteIdsJson = JsonSerializer.Serialize(sites), SubjectIdsJson = JsonSerializer.Serialize(rows.Select(x => x.subject.Id).Distinct()) };
        export.PayloadJson = JsonSerializer.Serialize(new { exportId = export.Id, studyId, cutoff = export.CreatedAt, purpose, records = payloadRows });
        export.ContentHash = ContractEngine.Hash(export.PayloadJson); db.Exports.Add(export);
        access.Evidence(studyId, null, actor.Id, "export.created", export.Id, reason, new { resourceId = export.Id, export.ContentHash });
        await db.SaveChangesAsync(); return new { export.Id, export.CreatedAt, export.ContentHash, count = payloadRows.Count };
    }
    [HttpGet("exports/{id:guid}")]
    public async Task<IActionResult> Download(Guid id)
    {
        var actor = await access.Actor(); var export = await db.Exports.FindAsync(id) ?? throw PlatformError.Missing();
        if (export.RequestedBy != actor.Id) throw PlatformError.Missing();
        foreach (var site in JsonSerializer.Deserialize<Guid[]>(export.SiteIdsJson) ?? [])
            await access.Require(export.StudyId, Permission.Export | Permission.Read, site);
        foreach (var subjectId in JsonSerializer.Deserialize<Guid[]>(export.SubjectIdsJson) ?? [])
        { var subject = await access.Subject(subjectId, Permission.Read); await access.CollectionAllowed(subject, export.Purpose); }
        return Content(export.PayloadJson, "application/json");
    }
    [HttpGet("studies/{studyId:guid}/audit")]
    public async Task<object> Audit(Guid studyId)
    {
        var actor = await access.Actor(); var sites = await access.Sites(studyId, Permission.Review);
        var manager = await access.Can(actor.Id, studyId, Permission.ManageStudy);
        if (!manager && sites.Length == 0) throw PlatformError.Missing();
        return await db.Audit.Where(x => x.StudyId == studyId && (x.SiteId == null ? manager : sites.Contains(x.SiteId.Value)))
            .OrderByDescending(x => x.CreatedAt).Take(200).ToListAsync();
    }
}
