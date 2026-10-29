using System.Text.Json;
using System.Text.Json.Nodes;
using FormPlatform.Api.Core;
using FormPlatform.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace FormPlatform.Api.Modules;

[ApiController, Authorize, Route("api")]
public sealed class ResponsesController(PlatformDb db, Access access, ContractEngine engine, ResponseWriter writer) : ControllerBase
{
    public record NewOccurrence(Guid AdoptionId, int Number);
    [HttpPost("visits/{visitId:guid}/occurrences")]
    public async Task<object> CreateOccurrence(Guid visitId, NewOccurrence input)
    {
        var visit = await db.Visits.FindAsync(visitId) ?? throw PlatformError.Missing();
        var subject = await access.Subject(visit.SubjectId, Permission.Collect); var actor = await access.Actor();
        await access.CollectionAllowed(subject);
        var adoption = await db.Adoptions.FindAsync(input.AdoptionId) ?? throw PlatformError.Missing();
        PlatformError.Check(adoption.Active && adoption.StudyId == subject.StudyId && (adoption.VisitDefinitionId == null || adoption.VisitDefinitionId == visit.DefinitionId), "ADOPTION_MISMATCH", "表單採用設定不適用於此研究／訪視。");
        PlatformError.Check(input.Number >= 1 && input.Number <= adoption.MaximumOccurrences, "OCCURRENCE_LIMIT", "超過允許的填寫次數。");
        var version = await db.Versions.FindAsync(adoption.FormVersionId) ?? throw PlatformError.Missing();
        await Published(version, subject.StudyId);
        var occurrence = new FormOccurrence { SubjectVisitId = visitId, AdoptionId = adoption.Id, Number = input.Number };
        db.Occurrences.Add(occurrence); access.Evidence(subject.StudyId, subject.SiteId, actor.Id, "occurrence.created", occurrence.Id);
        await db.SaveChangesAsync(); return occurrence;
    }
    [HttpGet("visits/{visitId:guid}/occurrences")]
    public async Task<object> Occurrences(Guid visitId)
    {
        var visit = await db.Visits.FindAsync(visitId) ?? throw PlatformError.Missing(); await access.Subject(visit.SubjectId, Permission.Read);
        return await db.Occurrences.Where(x => x.SubjectVisitId == visitId).Select(x => new { x.Id, x.AdoptionId, x.Number, x.NotDoneReason, x.Revision,
            response = db.Responses.Where(r => r.OccurrenceId == x.Id).Select(r => new { r.Id, r.State, r.Revision, r.UpdatedAt }).FirstOrDefault() }).ToListAsync();
    }
    [HttpGet("occurrences/{id:guid}/form")]
    public async Task<object> OccurrenceForm(Guid id)
    {
        var (_, _, subject, adoption) = await Context(id, Permission.Collect); await access.CollectionAllowed(subject);
        var version = await db.Versions.FindAsync(adoption.FormVersionId) ?? throw PlatformError.Missing(); await Published(version, subject.StudyId);
        return new { version.Id, version.Version, version.ContentHash, contract = JsonNode.Parse(version.ContractJson) };
    }
    [HttpGet("occurrences/{id:guid}/context")]
    public async Task<object> LaunchContext(Guid id)
    {
        var (occurrence, visit, subject, adoption) = await Context(id, Permission.Read);
        var actor = await access.Actor();
        var response = await db.Responses.SingleOrDefaultAsync(x => x.OccurrenceId == id);
        return new { occurrence.Id, subjectCode = subject.Code, visitName = visit.Name, occurrence.Number, occurrence.NotDoneReason,
            adoption.FormVersionId, canCollect = await access.Can(actor.Id, subject.StudyId, Permission.Collect, subject.SiteId),
            response = response == null ? null : new { response.Id, response.State, response.Revision } };
    }
    public record ResponseInput(JsonObject Data);
    [HttpPost("occurrences/{id:guid}/responses")]
    public async Task<object> Create(Guid id, ResponseInput input)
    {
        return View(await writer.Create(id, input.Data, new ResponseSource("portal")));
    }
    [HttpGet("responses/{id:guid}")]
    public async Task<object> Get(Guid id)
    { var (response, _) = await ResponseContext(id, Permission.Read); return View(response); }
    [HttpGet("responses/{id:guid}/form")]
    public async Task<object> PinnedForm(Guid id)
    {
        var (response, _) = await ResponseContext(id, Permission.Read);
        var version = await db.Versions.FindAsync(response.FormVersionId) ?? throw PlatformError.Missing();
        return new { version.Id, version.Version, version.ContentHash, contract = JsonNode.Parse(version.ContractJson) };
    }
    public record ResponseUpdate(long ExpectedRevision, JsonObject Data, string Reason);
    [HttpPut("responses/{id:guid}")]
    public async Task<object> Update(Guid id, ResponseUpdate input)
    {
        return View(await writer.Update(id, input.ExpectedRevision, input.Data, input.Reason, new ResponseSource("portal")));
    }
    public record ResponseAction(long ExpectedRevision, string Reason);
    [HttpPost("responses/{id:guid}/{operation}")]
    public async Task<object> Transition(Guid id, string operation, ResponseAction input)
    {
        var action = operation;
        var permission = action switch { "submit" => Permission.Collect, "review" or "return" => Permission.Review, "lock" or "unlock" => Permission.Lock, _ => throw PlatformError.Missing() };
        var (response, subject) = await ResponseContext(id, permission); var actor = await access.Actor();
        await access.CollectionAllowed(subject); PlatformError.Revision(input.ExpectedRevision, response.Revision);
        var reason = PlatformError.Text(input.Reason, "操作理由", 2000);
        switch (action)
        {
            case "submit":
                PlatformError.Check(response.State is "draft" or "needs-correction", "INVALID_STATE", "只有草稿或待修正填答可送出。");
                var version = await db.Versions.FindAsync(response.FormVersionId) ?? throw PlatformError.Missing();
                EnsureValid(engine.Evaluate(engine.Contract(version.ContractJson), JsonNode.Parse(response.DataJson)!.AsObject(), true).Issues);
                response.State = "submitted"; response.ReviewedBy = null; break;
            case "review":
                PlatformError.Check(response.State == "submitted" && response.UpdatedBy != actor.Id, "INDEPENDENT_REVIEW_REQUIRED", "須由填寫者以外人員審閱已送出資料。");
                PlatformError.Check(!await db.Queries.AnyAsync(x => x.ResponseId == id && x.State != "closed"), "QUERY_OPEN", "仍有未結案資料疑問。");
                response.State = "reviewed"; response.ReviewedBy = actor.Id; break;
            case "return":
                PlatformError.Check(response.State is "submitted" or "reviewed", "INVALID_STATE", "只能退回已送出或已審閱填答。");
                response.State = "needs-correction"; response.ReviewedBy = null; break;
            case "lock":
                PlatformError.Check(response.State == "reviewed", "REVIEW_REQUIRED", "只能鎖定已審閱填答。"); response.State = "locked"; break;
            case "unlock":
                PlatformError.Check(response.State == "locked", "INVALID_STATE", "此填答尚未鎖定。"); response.State = "submitted"; response.ReviewedBy = null; break;
        }
        // State transitions also have immutable revision evidence; a reviewer does not become the data author.
        db.Revisions.Add(new ResponseRevision { ResponseId = id, ResponseRevisionNumber = response.Revision + 1, ActorId = actor.Id,
            PreviousJson = response.DataJson, DataJson = response.DataJson, Reason = action + ": " + reason });
        response.UpdatedAt = DateTimeOffset.UtcNow;
        access.Evidence(subject.StudyId, subject.SiteId, actor.Id, "response." + action, id, reason, new { resourceId = id, revision = response.Revision + 1 });
        await db.SaveChangesAsync(); return View(response);
    }
    [HttpGet("responses/{id:guid}/revisions")]
    public async Task<object> Revisions(Guid id)
    { await ResponseContext(id, Permission.Read); return await db.Revisions.Where(x => x.ResponseId == id).OrderBy(x => x.ResponseRevisionNumber).ToListAsync(); }
    public record QueryInput(string Path, string Question);
    [HttpPost("responses/{id:guid}/queries")]
    public async Task<object> Query(Guid id, QueryInput input)
    {
        var (response, subject) = await ResponseContext(id, Permission.Review); var actor = await access.Actor();
        PlatformError.Check(response.State is "submitted" or "reviewed" or "needs-correction", "QUERY_STATE", "此狀態不能開立資料疑問。");
        var version = await db.Versions.FindAsync(response.FormVersionId) ?? throw PlatformError.Missing();
        PlatformError.Check(engine.Contract(version.ContractJson)["x-airwayai"]!["fields"]?[input.Path] != null, "QUERY_PATH", "資料疑問須指向現有欄位。");
        var query = new DataQuery { ResponseId = id, Path = input.Path, Question = PlatformError.Text(input.Question, "疑問內容", 2000), OpenedBy = actor.Id };
        db.Queries.Add(query); response.State = "needs-correction"; response.ReviewedBy = null;
        db.Revisions.Add(new ResponseRevision { ResponseId = id, ResponseRevisionNumber = response.Revision + 1, ActorId = actor.Id, PreviousJson = response.DataJson, DataJson = response.DataJson, Reason = "開立資料疑問" });
        access.Evidence(subject.StudyId, subject.SiteId, actor.Id, "query.opened", query.Id); await db.SaveChangesAsync(); return query;
    }
    [HttpGet("responses/{id:guid}/queries")]
    public async Task<object> Queries(Guid id)
    { await ResponseContext(id, Permission.Read); return await db.Queries.Where(x => x.ResponseId == id).OrderBy(x => x.CreatedAt).ToListAsync(); }
    public record QueryAction(long ExpectedRevision, string Answer);
    [HttpPost("queries/{id:guid}/{operation}")]
    public async Task<object> Answer(Guid id, string operation, QueryAction input)
    {
        var action = operation;
        var query = await db.Queries.FindAsync(id) ?? throw PlatformError.Missing();
        PlatformError.Check(action is "answer" or "close", "QUERY_ACTION", "資料疑問操作無效。");
        var (response, subject) = await ResponseContext(query.ResponseId, action == "answer" ? Permission.Collect : Permission.Review);
        var actor = await access.Actor(); await access.CollectionAllowed(subject); PlatformError.Revision(input.ExpectedRevision, query.Revision);
        PlatformError.Check(response.State != "locked" && query.State != "closed", "QUERY_CLOSED", "已鎖定或結案，不能修改。");
        if (action == "answer") { query.Answer = PlatformError.Text(input.Answer, "回覆", 2000); query.State = "answered"; }
        else { PlatformError.Check(query.State == "answered", "QUERY_UNANSWERED", "尚未回覆的資料疑問不能結案。"); query.State = "closed"; query.ClosedBy = actor.Id; }
        access.Evidence(subject.StudyId, subject.SiteId, actor.Id, "query." + action, id); await db.SaveChangesAsync(); return query;
    }
    private async Task Published(FormVersion version, Guid studyId)
    {
        PlatformError.Check(version.State == "published" && version.ApprovalHash == ContractEngine.Hash(version.ContractJson), "FORM_NOT_PUBLISHED", "版本未正式發布或核准內容不一致。");
        var study = await db.Studies.FindAsync(studyId) ?? throw PlatformError.Missing();
        EnsureValid(engine.PublicationIssues(engine.Contract(version.ContractJson), JsonSerializer.Deserialize<string[]>(study.RequiredMappingsJson) ?? []));
    }
    private async Task<(FormOccurrence, SubjectVisit, Subject, StudyFormAdoption)> Context(Guid occurrenceId, Permission permission)
    {
        var occurrence = await db.Occurrences.FindAsync(occurrenceId) ?? throw PlatformError.Missing();
        var visit = await db.Visits.FindAsync(occurrence.SubjectVisitId) ?? throw PlatformError.Missing();
        var subject = await access.Subject(visit.SubjectId, permission);
        var adoption = await db.Adoptions.FindAsync(occurrence.AdoptionId) ?? throw PlatformError.Missing();
        return (occurrence, visit, subject, adoption);
    }
    private async Task<(FormResponse, Subject)> ResponseContext(Guid id, Permission permission)
    {
        var response = await db.Responses.FindAsync(id) ?? throw PlatformError.Missing();
        var (_, _, subject, _) = await Context(response.OccurrenceId, permission); return (response, subject);
    }
    private static void EnsureValid(List<RuleIssue> issues)
    { if (issues.Count > 0) throw PlatformError.Invalid("VALIDATION_FAILED", "資料或標準對應不符合規則。", issues); }
    private static object View(FormResponse response) => new { response.Id, response.OccurrenceId, response.FormVersionId, response.State,
        data = JsonNode.Parse(response.DataJson), response.Revision, response.UpdatedBy, response.UpdatedAt, response.ReviewedBy };
}
