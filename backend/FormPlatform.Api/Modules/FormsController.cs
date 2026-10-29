using System.Text.Json;
using System.Text.Json.Nodes;
using FormPlatform.Api.Core;
using FormPlatform.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace FormPlatform.Api.Modules;

[ApiController, Authorize, Route("api")]
public sealed class FormsController(PlatformDb db, Access access, ContractEngine engine) : ControllerBase
{
    [HttpGet("template-library")]
    public async Task<object> Library()
    {
        var actor = await access.Actor();
        var studies = await db.Grants.Where(x => x.UserId == actor.Id && (x.ExpiresAt == null || x.ExpiresAt > DateTimeOffset.UtcNow)).Select(x => x.StudyId).Distinct().ToArrayAsync();
        return await (from version in db.Versions where version.State == "published"
            join template in db.Templates on version.TemplateId equals template.Id
            join study in db.Studies on template.StudyId equals study.Id
            where studies.Contains(study.Id)
            orderby study.Name, template.Name, version.Version
            select new { versionId = version.Id, templateName = template.Name, studyName = study.Name, version.Version, version.ContentHash }).ToListAsync();
    }
    [HttpGet("studies/{studyId:guid}/templates")]
    public async Task<object> Templates(Guid studyId)
    {
        await Reader(studyId);
        return await db.Templates.Where(x => x.StudyId == studyId).OrderBy(x => x.Name).ToListAsync();
    }
    public record TemplateInput(string Name, string Kind);
    [HttpPost("studies/{studyId:guid}/templates")]
    public async Task<object> Create(Guid studyId, TemplateInput input)
    {
        var actor = await access.Require(studyId, Permission.Design);
        PlatformError.Check(input.Kind is "ecrf", "TEMPLATE_KIND", "eCRF 使用欄位合約，ICF 請使用文件管理端點。");
        var template = new FormTemplate { StudyId = studyId, Name = PlatformError.Text(input.Name, "範本名稱"), Kind = input.Kind };
        db.Templates.Add(template); access.Evidence(studyId, null, actor.Id, "template.created", template.Id);
        await db.SaveChangesAsync(); return template;
    }
    [HttpGet("templates/{templateId:guid}/versions")]
    public async Task<object> Versions(Guid templateId)
    {
        var template = await db.Templates.FindAsync(templateId) ?? throw PlatformError.Missing(); await Reader(template.StudyId);
        return await db.Versions.Where(x => x.TemplateId == templateId).OrderByDescending(x => x.CreatedAt).ToListAsync();
    }
    public record VersionInput(string Version, JsonObject Contract, string SourceYaml);
    [HttpPost("templates/{templateId:guid}/versions")]
    public async Task<object> CreateVersion(Guid templateId, VersionInput input)
    {
        var template = await db.Templates.FindAsync(templateId) ?? throw PlatformError.Missing();
        var actor = await access.Require(template.StudyId, Permission.Design);
        var json = input.Contract.ToJsonString(); engine.Contract(json);
        var name = PlatformError.Text(input.Version, "版本", 60);
        EnsureVersionIdentity(input.Contract, name);
        var previous = await db.Versions.Where(x => x.TemplateId == templateId).Select(x => new { x.Version, x.ContractJson }).ToListAsync();
        PlatformError.Check(!previous.Any(x => x.Version == name), "VERSION_EXISTS", "同一範本已存在此版本編號。");
        PlatformError.Check(!previous.Any(x => JsonNode.Parse(x.ContractJson)?["$id"]?.GetValue<string>() == input.Contract["$id"]?.GetValue<string>()), "CONTRACT_ID_EXISTS", "新版本須使用新的契約識別碼，不能沿用前版 $id。");
        PlatformError.Check(input.SourceYaml.Length <= 2_000_000 && json.Length <= 2_000_000, "FORM_TOO_LARGE", "表單超過大小限制。");
        var version = new FormVersion { TemplateId = templateId, Version = name, ContractJson = json,
            SourceYaml = input.SourceYaml, ContentHash = ContractEngine.Hash(json), DesignersJson = JsonSerializer.Serialize(new[] { actor.Id }) };
        db.Versions.Add(version); access.Evidence(template.StudyId, null, actor.Id, "form.version.created", version.Id);
        await db.SaveChangesAsync(); return version;
    }
    [HttpGet("form-versions/{id:guid}")]
    public async Task<object> Version(Guid id)
    { var (version, template) = await Load(id); await Reader(template.StudyId); return version; }
    public record VersionUpdate(long ExpectedRevision, JsonObject Contract, string SourceYaml, string Reason);
    [HttpPut("form-versions/{id:guid}")]
    public async Task<object> Update(Guid id, VersionUpdate input)
    {
        var (version, template) = await Load(id); var actor = await access.Require(template.StudyId, Permission.Design);
        PlatformError.Revision(input.ExpectedRevision, version.Revision);
        PlatformError.Check(version.State is "draft" or "submitted", "VERSION_IMMUTABLE", "已發布版本不可修改，請建立新版本。");
        var json = input.Contract.ToJsonString(); engine.Contract(json);
        EnsureVersionIdentity(input.Contract, version.Version);
        PlatformError.Check(input.Contract["$id"]?.GetValue<string>() == JsonNode.Parse(version.ContractJson)?["$id"]?.GetValue<string>(), "CONTRACT_ID_IMMUTABLE", "既有版本的契約識別碼不可變更，請另建新版本。");
        PlatformError.Check(input.SourceYaml.Length <= 2_000_000 && json.Length <= 2_000_000, "FORM_TOO_LARGE", "表單超過大小限制。");
        version.ContractJson = json; version.SourceYaml = input.SourceYaml; version.ContentHash = ContractEngine.Hash(json);
        version.State = "draft"; version.ApprovedBy = null; version.ApprovedAt = null; version.ApprovalHash = null;
        version.DesignersJson = JsonSerializer.Serialize((JsonSerializer.Deserialize<Guid[]>(version.DesignersJson) ?? []).Append(actor.Id).Distinct());
        access.Evidence(template.StudyId, null, actor.Id, "form.version.changed", id, PlatformError.Text(input.Reason, "變更理由", 2000));
        await db.SaveChangesAsync(); return version;
    }
    public record VersionAction(long ExpectedRevision, string Reason);
    [HttpPost("form-versions/{id:guid}/{operation}")]
    public async Task<object> Transition(Guid id, string operation, VersionAction input)
    {
        var action = operation;
        var (version, template) = await Load(id);
        var actor = await access.Require(template.StudyId, action is "publish" or "retire" ? Permission.Publish : Permission.Design);
        PlatformError.Revision(input.ExpectedRevision, version.Revision);
        var reason = PlatformError.Text(input.Reason, "操作理由", 2000);
        var contract = engine.Contract(version.ContractJson);
        var study = await db.Studies.FindAsync(template.StudyId) ?? throw PlatformError.Missing();
        if (action is "submit" or "publish") EnsureMappings(contract, study);
        switch (action)
        {
            case "submit":
                PlatformError.Check(version.State == "draft", "INVALID_STATE", "只有草稿可送審。"); version.State = "submitted"; break;
            case "test-publish":
                PlatformError.Check(version.State == "draft", "INVALID_STATE", "只有草稿可測試發布。"); version.State = "test-published"; break;
            case "publish":
                PlatformError.Check(version.State == "submitted", "INVALID_STATE", "表單須先送審。");
                PlatformError.Check(!(JsonSerializer.Deserialize<Guid[]>(version.DesignersJson) ?? []).Contains(actor.Id), "SELF_APPROVAL", "設計者不能核准自己的正式版本。");
                version.State = "published"; version.ApprovedBy = actor.Id; version.ApprovedAt = DateTimeOffset.UtcNow; version.ApprovalHash = version.ContentHash; break;
            case "retire":
                PlatformError.Check(version.State is "published" or "test-published", "INVALID_STATE", "此版本尚未發布。"); version.State = "retired"; break;
            default: throw PlatformError.Missing();
        }
        access.Evidence(template.StudyId, null, actor.Id, "form." + action, id, reason, new { resourceId = id, version = version.Version, contentHash = version.ContentHash });
        await db.SaveChangesAsync(); return version;
    }
    public record AdoptionInput(Guid FormVersionId, Guid? VisitDefinitionId, int MaximumOccurrences, string Reason);
    [HttpPost("studies/{studyId:guid}/adoptions")]
    public async Task<object> Adopt(Guid studyId, AdoptionInput input)
    {
        var actor = await access.Require(studyId, Permission.Publish);
        var (version, template) = await Load(input.FormVersionId); await Reader(template.StudyId);
        PlatformError.Check(version.State == "published" && version.ApprovalHash == ContractEngine.Hash(version.ContractJson), "FORM_NOT_PUBLISHED", "只能採用已正式核准且內容一致的版本。");
        var study = await db.Studies.FindAsync(studyId) ?? throw PlatformError.Missing(); EnsureMappings(engine.Contract(version.ContractJson), study);
        PlatformError.Check(input.MaximumOccurrences is >= 1 and <= 100, "OCCURRENCE_LIMIT", "重複填寫上限須介於 1 至 100。");
        PlatformError.Check(input.VisitDefinitionId == null || await db.VisitDefinitions.AnyAsync(x => x.Id == input.VisitDefinitionId && x.StudyId == studyId), "VISIT_MISMATCH", "訪視不屬於研究。");
        var adoption = new StudyFormAdoption { StudyId = studyId, FormVersionId = version.Id, VisitDefinitionId = input.VisitDefinitionId, MaximumOccurrences = input.MaximumOccurrences };
        db.Adoptions.Add(adoption); access.Evidence(studyId, null, actor.Id, "form.adopted", adoption.Id, PlatformError.Text(input.Reason, "採用理由", 2000));
        await db.SaveChangesAsync(); return adoption;
    }
    [HttpGet("studies/{studyId:guid}/adoptions")]
    public async Task<object> Adoptions(Guid studyId)
    { await Reader(studyId); return await db.Adoptions.Where(x => x.StudyId == studyId).ToListAsync(); }
    [HttpGet("form-versions/{id:guid}/diff/{otherId:guid}")]
    public async Task<object> Diff(Guid id, Guid otherId)
    {
        var (left, lt) = await Load(id); var (right, rt) = await Load(otherId); await Reader(lt.StudyId); await Reader(rt.StudyId);
        var a = engine.Contract(left.ContractJson)["x-airwayai"]!["fields"]!.AsObject(); var b = engine.Contract(right.ContractJson)["x-airwayai"]!["fields"]!.AsObject();
        var changes = a.Select(x => x.Key).Union(b.Select(x => x.Key)).Where(p => !JsonNode.DeepEquals(a[p], b[p])).Select(p => new { path = p, before = a[p], after = b[p] }).ToArray();
        return new { from = left.Version, to = right.Version, changes, contractChanged = left.ContentHash != right.ContentHash,
            contractChanges = ContractChanges(engine.Contract(left.ContractJson), engine.Contract(right.ContractJson), ""),
            propertiesBefore = JsonNode.Parse(left.ContractJson)!["properties"], propertiesAfter = JsonNode.Parse(right.ContractJson)!["properties"] };
    }
    private sealed record ContractChange(string Path, JsonNode? Before, JsonNode? After);
    private static List<ContractChange> ContractChanges(JsonNode? before, JsonNode? after, string path)
    {
        if (JsonNode.DeepEquals(before, after)) return [];
        if (before is JsonObject a && after is JsonObject b)
        {
            var result = new List<ContractChange>();
            foreach (var key in a.Select(x => x.Key).Union(b.Select(x => x.Key)).OrderBy(x => x, StringComparer.Ordinal))
                result.AddRange(ContractChanges(a[key], b[key], path + "/" + key.Replace("~", "~0").Replace("/", "~1")));
            return result;
        }
        return [new(path, before?.DeepClone(), after?.DeepClone())];
    }
    private async Task Reader(Guid study)
    {
        var actor = await access.Actor();
        if (!await db.Grants.AnyAsync(x => x.UserId == actor.Id && x.StudyId == study && (x.ExpiresAt == null || x.ExpiresAt > DateTimeOffset.UtcNow))) throw PlatformError.Missing();
    }
    private async Task<(FormVersion, FormTemplate)> Load(Guid id)
    {
        var version = await db.Versions.FindAsync(id) ?? throw PlatformError.Missing();
        return (version, await db.Templates.FindAsync(version.TemplateId) ?? throw PlatformError.Missing());
    }
    private static void EnsureVersionIdentity(JsonObject contract, string name)
    {
        PlatformError.Check(contract["x-airwayai"]?["schemaVersion"]?.GetValue<string>() == name,
            "VERSION_MISMATCH", "版本編號須與表單契約 schemaVersion 相同。");
        var formId = contract["x-airwayai"]?["formId"]?.GetValue<string>();
        PlatformError.Check(contract["$id"]?.GetValue<string>().EndsWith($"/{formId}/{name}", StringComparison.Ordinal) == true,
            "CONTRACT_ID_MISMATCH", "契約識別碼須以 formId/schemaVersion 結尾。");
    }
    private void EnsureMappings(JsonObject contract, Study study)
    {
        var issues = engine.PublicationIssues(contract, JsonSerializer.Deserialize<string[]>(study.RequiredMappingsJson) ?? []);
        if (issues.Count != 0) throw PlatformError.Invalid("MAPPING_REQUIRED", "必要 CDISC 對應尚未完成。", issues);
    }
}
