using System.Text.Json;
using System.Text.Json.Nodes;
using FormPlatform.Api.Core;
using FormPlatform.Api.Data;
using Microsoft.EntityFrameworkCore;
namespace FormPlatform.Api.Modules;

public sealed record ResponseSource(string System, string? ExternalRecordId = null);

// Both browser and integration commands use this service; authorization and collection
// validation are deliberately inside the command boundary, not just in controllers.
public sealed class ResponseWriter(PlatformDb db, Access access, ContractEngine engine)
{
    public async Task<FormResponse> Create(Guid occurrenceId, JsonObject input, ResponseSource source)
    {
        var occurrence = await db.Occurrences.FindAsync(occurrenceId) ?? throw PlatformError.Missing();
        var visit = await db.Visits.FindAsync(occurrence.SubjectVisitId) ?? throw PlatformError.Missing();
        var subject = await access.Subject(visit.SubjectId, Permission.Collect); var actor = await access.Actor();
        PlatformError.Check(actor.IntegrationSource == null || source.System == actor.IntegrationSource, "INTEGRATION_ROUTE_REQUIRED", "整合程式須使用具來源與去重控制的寫入端點。");
        await access.CollectionAllowed(subject);
        var adoption = await db.Adoptions.FindAsync(occurrence.AdoptionId) ?? throw PlatformError.Missing();
        PlatformError.Check(occurrence.NotDoneReason == null && adoption.Active, "OCCURRENCE_INACTIVE", "此應收表單已標記不執行或停用。");
        var version = await db.Versions.FindAsync(adoption.FormVersionId) ?? throw PlatformError.Missing();
        PlatformError.Check(version.State == "published" && version.ApprovalHash == ContractEngine.Hash(version.ContractJson), "FORM_NOT_PUBLISHED", "只能收集已正式核准的固定版本。");
        var contract = engine.Contract(version.ContractJson); var study = await db.Studies.FindAsync(subject.StudyId) ?? throw PlatformError.Missing();
        EnsureValid(engine.PublicationIssues(contract, JsonSerializer.Deserialize<string[]>(study.RequiredMappingsJson) ?? []));
        var result = engine.Evaluate(contract, input, false); EnsureValid(result.Issues);
        var response = new FormResponse { OccurrenceId = occurrenceId, FormVersionId = version.Id, DataJson = result.Data.ToJsonString(), UpdatedBy = actor.Id };
        db.Responses.Add(response);
        db.Revisions.Add(new ResponseRevision { ResponseId = response.Id, ResponseRevisionNumber = 1, ActorId = actor.Id,
            DataJson = response.DataJson, Reason = "建立填答草稿", Source = source.System, ExternalRecordId = source.ExternalRecordId });
        access.Evidence(subject.StudyId, subject.SiteId, actor.Id, "response.created", response.Id,
            payload: new { resourceId = response.Id, revision = 1, source = source.System });
        await db.SaveChangesAsync(); return response;
    }

    public async Task<FormResponse> Update(Guid id, long expectedRevision, JsonObject input, string reason, ResponseSource source)
    {
        var response = await db.Responses.FindAsync(id) ?? throw PlatformError.Missing();
        var occurrence = await db.Occurrences.FindAsync(response.OccurrenceId) ?? throw PlatformError.Missing();
        var visit = await db.Visits.FindAsync(occurrence.SubjectVisitId) ?? throw PlatformError.Missing();
        var subject = await access.Subject(visit.SubjectId, Permission.Collect); var actor = await access.Actor();
        PlatformError.Check(actor.IntegrationSource == null || source.System == actor.IntegrationSource, "INTEGRATION_ROUTE_REQUIRED", "整合程式須使用具來源與去重控制的寫入端點。");
        await access.CollectionAllowed(subject); PlatformError.Revision(expectedRevision, response.Revision);
        PlatformError.Check(response.State != "locked", "RESPONSE_LOCKED", "填答已鎖定，須先授權解鎖。");
        var actualReason = response.State == "draft" && source.System == "portal" ? "修改草稿" : PlatformError.Text(reason, "更正理由", 2000);
        var version = await db.Versions.FindAsync(response.FormVersionId) ?? throw PlatformError.Missing();
        var result = engine.Evaluate(engine.Contract(version.ContractJson), input, response.State != "draft"); EnsureValid(result.Issues);
        var previous = response.DataJson; response.DataJson = result.Data.ToJsonString();
        if (response.State != "draft") response.State = "submitted";
        response.ReviewedBy = null; response.UpdatedBy = actor.Id; response.UpdatedAt = DateTimeOffset.UtcNow;
        db.Revisions.Add(new ResponseRevision { ResponseId = id, ResponseRevisionNumber = response.Revision + 1, ActorId = actor.Id,
            PreviousJson = previous, DataJson = response.DataJson, Reason = actualReason, Source = source.System, ExternalRecordId = source.ExternalRecordId });
        access.Evidence(subject.StudyId, subject.SiteId, actor.Id, "response.corrected", id, actualReason,
            new { resourceId = id, revision = response.Revision + 1, source = source.System });
        await db.SaveChangesAsync(); return response;
    }
    public static object View(FormResponse response) => new { response.Id, response.OccurrenceId, response.FormVersionId, response.State,
        data = JsonNode.Parse(response.DataJson), response.Revision, response.UpdatedBy, response.UpdatedAt, response.ReviewedBy };
    private static void EnsureValid(List<RuleIssue> issues)
    { if (issues.Count > 0) throw PlatformError.Invalid("VALIDATION_FAILED", "資料或標準對應不符合規則。", issues); }
}
