using System.Text.Json;
using System.Text.Json.Nodes;
using FormPlatform.Api.Core;
using FormPlatform.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace FormPlatform.Api.Modules;

[ApiController, Authorize, Route("api/integrations")]
public sealed class IntegrationsController(PlatformDb db, Access access, ResponseWriter writer) : ControllerBase
{
    public record ExternalSubject(Guid SiteId, string ExternalId, string Code);
    [HttpPost("studies/{studyId:guid}/subjects")]
    public async Task<object> Subject(Guid studyId, ExternalSubject input)
    {
        var actor = await Integrator(studyId, input.SiteId);
        var study = await db.Studies.FindAsync(studyId) ?? throw PlatformError.Missing();
        PlatformError.Check(study.ContextAuthority == "ctms", "PLATFORM_AUTHORITY", "此研究的脈絡由平台維護，不接受 CTMS 建檔。");
        PlatformError.Check(await db.Sites.AnyAsync(x => x.Id == input.SiteId && x.StudyId == studyId && x.Active), "SITE_MISMATCH", "院所不屬於研究或已停用。");
        var key = Key(); var hash = RequestHash("subject:" + studyId, input);
        var receipt = await Replay(actor, key, hash); if (receipt != null) return JsonNode.Parse(receipt.ResultJson)!;
        var external = PlatformError.Text(input.ExternalId, "外部研究代碼", 100);
        var mapping = await db.ExternalIds.SingleOrDefaultAsync(x => x.StudyId == studyId && x.SiteId == input.SiteId &&
            x.SourceSystem == actor.IntegrationSource && x.EntityType == "subject" && x.ExternalId == external);
        Data.Subject subject;
        if (mapping != null)
        {
            subject = await db.Subjects.FindAsync(mapping.PlatformId) ?? throw PlatformError.Missing();
            PlatformError.Check(subject.Code == input.Code.Trim(), "EXTERNAL_ID_CONFLICT", "外部代碼已關聯不同研究代碼，須受控更正而非重新建檔。");
        }
        else
        {
            subject = new Data.Subject { StudyId = studyId, SiteId = input.SiteId, Code = PlatformError.Text(input.Code, "研究代碼", 80) };
            db.Subjects.Add(subject);
            db.ExternalIds.Add(new ExternalIdentifierMapping { StudyId = studyId, SiteId = input.SiteId, SourceSystem = actor.IntegrationSource!, ExternalId = external, PlatformId = subject.Id });
            access.Evidence(studyId, input.SiteId, actor.Id, "external.subject.created", subject.Id);
        }
        var result = new { subject.Id, subject.Code, subject.SiteId, externalId = external, source = actor.IntegrationSource };
        Record(actor, key, hash, result); await db.SaveChangesAsync(); return result;
    }
    public record ExternalResponse(Guid OccurrenceId, string ExternalRecordId, JsonObject Data);
    public record ExternalVisit(Guid SubjectId, string ExternalId, Guid? DefinitionId, string Name, DateOnly Date, bool Unscheduled);
    [HttpPost("visits")]
    public async Task<object> Visit(ExternalVisit input)
    {
        var subject = await access.Subject(input.SubjectId, Permission.Collect);
        var actor = await Integrator(subject.StudyId, subject.SiteId);
        var study = await db.Studies.FindAsync(subject.StudyId) ?? throw PlatformError.Missing();
        PlatformError.Check(study.ContextAuthority == "ctms", "PLATFORM_AUTHORITY", "此研究由平台維護訪視。");
        var key = Key(); var hash = RequestHash("visit:create", input);
        var receipt = await Replay(actor, key, hash); if (receipt != null) return JsonNode.Parse(receipt.ResultJson)!;
        PlatformError.Check(input.Unscheduled ? input.DefinitionId == null : input.DefinitionId != null, "VISIT_DEFINITION_REQUIRED", "預定訪視須選擇定義。");
        PlatformError.Check(input.DefinitionId == null || await db.VisitDefinitions.AnyAsync(x => x.Id == input.DefinitionId && x.StudyId == subject.StudyId), "VISIT_MISMATCH", "訪視定義不屬於研究。");
        var external = PlatformError.Text(input.ExternalId, "外部訪視代碼", 100);
        var name = PlatformError.Text(input.Name, "訪視名稱");
        var mapping = await db.ExternalIds.SingleOrDefaultAsync(x => x.StudyId == subject.StudyId && x.SiteId == subject.SiteId && x.SourceSystem == actor.IntegrationSource && x.EntityType == "visit" && x.ExternalId == external);
        SubjectVisit visit;
        if (mapping != null)
        {
            visit = await db.Visits.FindAsync(mapping.PlatformId) ?? throw PlatformError.Missing();
            PlatformError.Check(visit.SubjectId == input.SubjectId && visit.DefinitionId == input.DefinitionId && visit.Name == name && visit.Date == input.Date && visit.Unscheduled == input.Unscheduled, "EXTERNAL_ID_CONFLICT", "外部訪視代碼已關聯不同訪視內容。");
        }
        else
        {
            visit = new SubjectVisit { SubjectId = subject.Id, DefinitionId = input.DefinitionId, Name = name, Date = input.Date, Unscheduled = input.Unscheduled };
            db.Visits.Add(visit);
            db.ExternalIds.Add(new ExternalIdentifierMapping { StudyId = subject.StudyId, SiteId = subject.SiteId, SourceSystem = actor.IntegrationSource!, EntityType = "visit", ExternalId = external, PlatformId = visit.Id });
            access.Evidence(subject.StudyId, subject.SiteId, actor.Id, "external.visit.created", visit.Id);
        }
        var result = new { visit.Id, visit.Name, visit.Date, visit.DefinitionId, visit.Unscheduled, visit.Revision, externalId = external, source = actor.IntegrationSource };
        Record(actor, key, hash, result); await db.SaveChangesAsync(); return result;
    }
    [HttpPost("responses")]
    public async Task<object> Create(ExternalResponse input)
    {
        var subject = await OccurrenceSubject(input.OccurrenceId); var actor = await Integrator(subject.StudyId, subject.SiteId);
        await access.CollectionAllowed(subject);
        var key = Key(); var hash = RequestHash("response:create", input);
        var receipt = await Replay(actor, key, hash); if (receipt != null) return JsonNode.Parse(receipt.ResultJson)!;
        var externalId = PlatformError.Text(input.ExternalRecordId, "外部紀錄 ID", 200);
        PlatformError.Check(!await db.ExternalIds.AnyAsync(x => x.StudyId == subject.StudyId && x.SiteId == subject.SiteId && x.SourceSystem == actor.IntegrationSource && x.EntityType == "response" && x.ExternalId == externalId), "EXTERNAL_RECORD_EXISTS", "外部紀錄已建立關聯，請使用更正端點。");
        var response = await writer.Create(input.OccurrenceId, input.Data, new ResponseSource(actor.IntegrationSource!, externalId));
        db.ExternalIds.Add(new ExternalIdentifierMapping { StudyId = subject.StudyId, SiteId = subject.SiteId, SourceSystem = actor.IntegrationSource!, EntityType = "response", ExternalId = externalId, PlatformId = response.Id });
        var result = ResponseWriter.View(response); Record(actor, key, hash, result); await db.SaveChangesAsync(); return result;
    }
    public record ExternalCorrection(long ExpectedRevision, string ExternalRecordId, JsonObject Data, string Reason);
    [HttpPut("responses/{id:guid}")]
    public async Task<object> Correct(Guid id, ExternalCorrection input)
    {
        var response = await db.Responses.FindAsync(id) ?? throw PlatformError.Missing();
        var subject = await OccurrenceSubject(response.OccurrenceId); var actor = await Integrator(subject.StudyId, subject.SiteId);
        await access.CollectionAllowed(subject);
        var key = Key(); var hash = RequestHash("response:correct:" + id, input);
        var receipt = await Replay(actor, key, hash); if (receipt != null) return JsonNode.Parse(receipt.ResultJson)!;
        var externalId = PlatformError.Text(input.ExternalRecordId, "外部紀錄 ID", 200);
        var mapping = await db.ExternalIds.SingleOrDefaultAsync(x => x.StudyId == subject.StudyId && x.SiteId == subject.SiteId && x.SourceSystem == actor.IntegrationSource && x.EntityType == "response" && x.ExternalId == externalId);
        PlatformError.Check(mapping == null || mapping.PlatformId == id, "EXTERNAL_ID_CONFLICT", "外部紀錄 ID 已關聯另一份填答。");
        response = await writer.Update(id, input.ExpectedRevision, input.Data, input.Reason,
            new ResponseSource(actor.IntegrationSource!, externalId));
        if (mapping == null) db.ExternalIds.Add(new ExternalIdentifierMapping { StudyId = subject.StudyId, SiteId = subject.SiteId, SourceSystem = actor.IntegrationSource!, EntityType = "response", ExternalId = externalId, PlatformId = id });
        var result = ResponseWriter.View(response); Record(actor, key, hash, result); await db.SaveChangesAsync(); return result;
    }
    [HttpGet("receipts/{key}")]
    public async Task<object> Receipt(string key)
    {
        var actor = await access.Actor();
        if (actor.IntegrationSource == null) throw PlatformError.Missing();
        var receipt = await db.Receipts.SingleOrDefaultAsync(x => x.ActorId == actor.Id && x.RequestKey == key) ?? throw PlatformError.Missing();
        // Only receipt metadata is exposed here; revoked resource permissions cannot leak old data.
        return new { receipt.RequestKey, receipt.RequestHash, receipt.CreatedAt };
    }
    private async Task<PlatformUser> Integrator(Guid study, Guid site)
    {
        var actor = await access.Require(study, Permission.Integrate | Permission.Collect, site);
        if (actor.IntegrationSource == null) throw PlatformError.Missing(); return actor;
    }
    private async Task<Data.Subject> OccurrenceSubject(Guid id)
    {
        var occurrence = await db.Occurrences.FindAsync(id) ?? throw PlatformError.Missing();
        var visit = await db.Visits.FindAsync(occurrence.SubjectVisitId) ?? throw PlatformError.Missing();
        return await access.Subject(visit.SubjectId, Permission.Collect);
    }
    private string Key() => PlatformError.Text(Request.Headers["Idempotency-Key"].ToString(), "Idempotency-Key", 100);
    private static string RequestHash(string operation, object body) => ContractEngine.Hash(JsonSerializer.Serialize(new { operation, body }));
    private async Task<IntegrationReceipt?> Replay(PlatformUser actor, string key, string hash)
    {
        var receipt = await db.Receipts.SingleOrDefaultAsync(x => x.ActorId == actor.Id && x.RequestKey == key);
        if (receipt != null && receipt.RequestHash != hash) throw new PlatformError(409, "IDEMPOTENCY_MISMATCH", "相同去重識別不能搭配不同內容或操作。");
        return receipt;
    }
    private void Record(PlatformUser actor, string key, string hash, object result) => db.Receipts.Add(new IntegrationReceipt
    { ActorId = actor.Id, RequestKey = key, RequestHash = hash, ResultJson = JsonSerializer.Serialize(result, new JsonSerializerOptions(JsonSerializerDefaults.Web)) });
}
