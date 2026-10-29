using System.Text.Json;
using FormPlatform.Api.Core;
using FormPlatform.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace FormPlatform.Api.Modules;

[ApiController, Authorize, Route("api")]
public sealed class ConsentController(PlatformDb db, Access access) : ControllerBase
{
    public record IcfInput(Guid? SiteId, string Name, string Version, string Locale, string Content, string ApprovalReference);
    [HttpPost("studies/{studyId:guid}/icfs")]
    public async Task<object> CreateIcf(Guid studyId, IcfInput input)
    {
        var actor = await access.Require(studyId, Permission.Design);
        PlatformError.Check(input.SiteId == null || await db.Sites.AnyAsync(x => x.Id == input.SiteId && x.StudyId == studyId), "SITE_MISMATCH", "ICF 院所不屬於研究。");
        var icf = new IcfVersion { State = "draft", Active = false, DesignersJson = JsonSerializer.Serialize(new[] { actor.Id }), StudyId = studyId, SiteId = input.SiteId, Name = PlatformError.Text(input.Name, "ICF 名稱"),
            Version = PlatformError.Text(input.Version, "ICF 版本", 60), Locale = PlatformError.Text(input.Locale, "語言", 30),
            Content = PlatformError.Text(input.Content, "ICF 內容", 100_000), ApprovalReference = PlatformError.Text(input.ApprovalReference, "核准依據", 2000) };
        db.Icfs.Add(icf); access.Evidence(studyId, input.SiteId, actor.Id, "icf.draft.created", icf.Id); await db.SaveChangesAsync(); return icf;
    }
    [HttpGet("studies/{studyId:guid}/icfs")]
    public async Task<object> Icfs(Guid studyId)
    {
        var actor = await access.Actor(); var sites = await access.Sites(studyId, Permission.Read);
        var designer = await access.Can(actor.Id, studyId, Permission.Design) || await access.Can(actor.Id, studyId, Permission.Publish);
        if (!designer && sites.Length == 0) throw PlatformError.Missing();
        return await db.Icfs.Where(x => x.StudyId == studyId && (designer || (x.State == "published" || x.State == "retired") && (x.SiteId == null || sites.Contains(x.SiteId.Value)))).ToListAsync();
    }
    public record IcfState(long ExpectedRevision, string Reason);
    [HttpPost("icfs/{id:guid}/retire")]
    public async Task<object> Retire(Guid id, IcfState input)
    {
        var icf = await db.Icfs.FindAsync(id) ?? throw PlatformError.Missing(); var actor = await access.Require(icf.StudyId, Permission.Publish);
        PlatformError.Revision(input.ExpectedRevision, icf.Revision);
        PlatformError.Check(icf.State == "published", "ICF_STATE", "只能停用已核准文件。必要時可另建修訂版本。");
        icf.Active = false; icf.State = "retired";
        access.Evidence(icf.StudyId, icf.SiteId, actor.Id, "icf.retired", id, PlatformError.Text(input.Reason, "停用理由", 2000));
        await db.SaveChangesAsync(); return icf;
    }
    public record IcfUpdate(long ExpectedRevision, string Name, string Version, string Locale, string Content, string ApprovalReference, string Reason);
    [HttpPut("icfs/{id:guid}/draft")]
    public async Task<object> EditIcf(Guid id, IcfUpdate input)
    {
        var icf = await db.Icfs.FindAsync(id) ?? throw PlatformError.Missing();
        var actor = await access.Require(icf.StudyId, Permission.Design);
        PlatformError.Revision(input.ExpectedRevision, icf.Revision);
        PlatformError.Check(icf.State is "draft" or "submitted", "ICF_IMMUTABLE", "核准文件不可覆寫，請另建版本。");
        icf.Name = PlatformError.Text(input.Name, "ICF 名稱"); icf.Version = PlatformError.Text(input.Version, "版本", 60);
        icf.Locale = PlatformError.Text(input.Locale, "語言", 30); icf.Content = PlatformError.Text(input.Content, "ICF 內容", 100_000);
        icf.ApprovalReference = PlatformError.Text(input.ApprovalReference, "核准依據", 2000); icf.State = "draft";
        icf.DesignersJson = JsonSerializer.Serialize((JsonSerializer.Deserialize<Guid[]>(icf.DesignersJson) ?? []).Append(actor.Id).Distinct());
        access.Evidence(icf.StudyId, icf.SiteId, actor.Id, "icf.draft.changed", id, PlatformError.Text(input.Reason, "修改理由", 2000));
        await db.SaveChangesAsync(); return icf;
    }
    [HttpPost("icfs/{id:guid}/workflow/{operation}")]
    public async Task<object> IcfWorkflow(Guid id, string operation, IcfState input)
    {
        var icf = await db.Icfs.FindAsync(id) ?? throw PlatformError.Missing();
        var actor = await access.Require(icf.StudyId, operation == "approve" ? Permission.Publish : Permission.Design);
        PlatformError.Revision(input.ExpectedRevision, icf.Revision);
        var reason = PlatformError.Text(input.Reason, "操作理由", 2000);
        if (operation == "submit")
        { PlatformError.Check(icf.State == "draft", "ICF_STATE", "只有草稿可以送審。"); icf.State = "submitted"; }
        else if (operation == "approve")
        {
            PlatformError.Check(icf.State == "submitted", "ICF_STATE", "文件須先送審。");
            PlatformError.Check(!(JsonSerializer.Deserialize<Guid[]>(icf.DesignersJson) ?? []).Contains(actor.Id), "SELF_APPROVAL", "文件設計參與人不能核准自己的 ICF。");
            PlatformError.Check(!await db.Icfs.AnyAsync(x => x.Id != id && x.StudyId == icf.StudyId && x.SiteId == icf.SiteId && x.Name == icf.Name && x.Version == icf.Version && x.Locale == icf.Locale && x.State == "published"), "ICF_VERSION_EXISTS", "已有相同名稱、版本、語言及院所的核准文件。");
            icf.State = "published"; icf.Active = true; icf.ApprovedBy = actor.Id; icf.ApprovedAt = DateTimeOffset.UtcNow;
            icf.ApprovalHash = ContractEngine.Hash(JsonSerializer.Serialize(new { icf.Name, icf.Version, icf.Locale, icf.Content, icf.ApprovalReference, icf.SiteId }));
        }
        else throw PlatformError.Missing();
        access.Evidence(icf.StudyId, icf.SiteId, actor.Id, "icf." + operation, id, reason);
        await db.SaveChangesAsync(); return icf;
    }
    public record BasisInput(string Kind, string Reference, Guid? IcfVersionId, DateOnly? SignedOn, string Purpose);
    [HttpPost("subjects/{subjectId:guid}/collection-bases")]
    public async Task<object> Register(Guid subjectId, BasisInput input)
    {
        var subject = await access.Subject(subjectId, Permission.Collect); var actor = await access.Actor();
        PlatformError.Check(input.Kind is "consent" or "waiver", "BASIS_KIND", "依據種類無效。");
        PlatformError.Check(input.Kind != "consent" || input.IcfVersionId != null && input.SignedOn != null && input.SignedOn <= DateOnly.FromDateTime(DateTime.UtcNow), "CONSENT_INCOMPLETE", "同意依據須填有效版本與簽署日期。");
        if (input.IcfVersionId != null) PlatformError.Check(await db.Icfs.AnyAsync(x => x.Id == input.IcfVersionId && x.StudyId == subject.StudyId && x.Active && x.State == "published" && (x.SiteId == null || x.SiteId == subject.SiteId)), "ICF_MISMATCH", "ICF 版本不適用於此研究／院所。");
        var basis = new CollectionBasis { SubjectId = subjectId, Kind = input.Kind, Reference = PlatformError.Text(input.Reference, "文件或免同意核准編號", 2000), IcfVersionId = input.IcfVersionId, SignedOn = input.SignedOn, Purpose = PlatformError.Text(input.Purpose, "用途", 80) };
        db.Bases.Add(basis); access.Evidence(subject.StudyId, subject.SiteId, actor.Id, "basis.registered", basis.Id); await db.SaveChangesAsync(); return basis;
    }
    [HttpGet("subjects/{subjectId:guid}/collection-bases")]
    public async Task<object> Bases(Guid subjectId)
    { await access.Subject(subjectId, Permission.Read); return await db.Bases.Where(x => x.SubjectId == subjectId).ToListAsync(); }
    public record BasisAction(long ExpectedRevision, string Reason);
    [HttpPost("collection-bases/{id:guid}/{operation}")]
    public async Task<object> Decide(Guid id, string operation, BasisAction input)
    {
        var action = operation;
        var basis = await db.Bases.FindAsync(id) ?? throw PlatformError.Missing();
        var subject = await access.Subject(basis.SubjectId, Permission.ConfirmBasis); var actor = await access.Actor();
        PlatformError.Revision(input.ExpectedRevision, basis.Revision);
        PlatformError.Check(action is "confirm" or "withdraw", "BASIS_ACTION", "依據操作無效。");
        PlatformError.Check(action != "confirm" || basis.State == "pending", "BASIS_STATE", "只能確認待審依據，撤回後須重新登錄。");
        if (action == "confirm" && basis.IcfVersionId != null) PlatformError.Check(await db.Icfs.AnyAsync(x => x.Id == basis.IcfVersionId && x.Active && x.State == "published"), "ICF_RETIRED", "ICF 已停用。");
        basis.State = action == "confirm" ? "confirmed" : "withdrawn";
        basis.ConfirmedBy = actor.Id; basis.ConfirmedAt = DateTimeOffset.UtcNow;
        basis.DecisionReason = PlatformError.Text(input.Reason, "確認或撤回理由", 2000);
        access.Evidence(subject.StudyId, subject.SiteId, actor.Id, "basis." + action, id, basis.DecisionReason); await db.SaveChangesAsync(); return basis;
    }
}
