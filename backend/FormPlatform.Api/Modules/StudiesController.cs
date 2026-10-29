using System.Text.Json;
using FormPlatform.Api.Core;
using FormPlatform.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace FormPlatform.Api.Modules;

[ApiController, Authorize, Route("api")]
public sealed class StudiesController(PlatformDb db, Access access) : ControllerBase
{
    [HttpGet("me")]
    public async Task<object> Me()
    {
        var actor = await access.Actor();
        return new { actor.Id, actor.Name, actor.IsOperator, actor.IntegrationSource, grants = await db.Grants.Where(x => x.UserId == actor.Id &&
            (x.ExpiresAt == null || x.ExpiresAt > DateTimeOffset.UtcNow)).ToListAsync() };
    }
    [HttpGet("users")]
    public async Task<object> Users()
    {
        var actor = await access.Actor();
        if (!actor.IsOperator && !await db.Grants.AnyAsync(x => x.UserId == actor.Id && (x.Permissions & Permission.ManageStudy) != 0 &&
            (x.ExpiresAt == null || x.ExpiresAt > DateTimeOffset.UtcNow))) throw PlatformError.Missing();
        return await db.Users.Where(x => x.Active).Select(x => new { x.Id, x.Name }).ToListAsync();
    }
    [HttpGet("studies")]
    public async Task<object> Studies()
    {
        var actor = await access.Actor();
        return await db.Studies.Where(s => db.Grants.Any(g => g.StudyId == s.Id && g.UserId == actor.Id &&
            (g.ExpiresAt == null || g.ExpiresAt > DateTimeOffset.UtcNow))).OrderBy(x => x.Code)
            .Select(x => new { x.Id, x.Code, x.Name, x.ContextAuthority, x.IcfCustody, x.Active, x.Revision, requiredMappings = x.RequiredMappingsJson }).ToListAsync();
    }
    public record NewStudy(string Code, string Name);
    [HttpPost("studies")]
    public async Task<object> CreateStudy(NewStudy input)
    {
        var actor = await access.RequireOperator();
        var study = new Study { Code = PlatformError.Text(input.Code, "研究代碼", 80), Name = PlatformError.Text(input.Name, "研究名稱") };
        db.Studies.Add(study);
        db.Grants.Add(new AccessGrant { UserId = actor.Id, StudyId = study.Id, CrossSite = true, Permissions = Permission.All });
        access.Evidence(study.Id, null, actor.Id, "study.created", study.Id); await db.SaveChangesAsync(); return study;
    }
    public record PolicyChange(long ExpectedRevision, string ContextAuthority, string IcfCustody, string[] RequiredMappings, bool Active, string Reason);
    [HttpPut("studies/{studyId:guid}/policy")]
    public async Task<object> Policy(Guid studyId, PolicyChange input)
    {
        var actor = await access.Require(studyId, Permission.ManageStudy);
        var study = await db.Studies.FindAsync(studyId) ?? throw PlatformError.Missing();
        PlatformError.Revision(input.ExpectedRevision, study.Revision);
        PlatformError.Check((input.ContextAuthority is "platform" or "ctms") && (input.IcfCustody is "site" or "central"), "INVALID_POLICY", "政策選項無效。");
        PlatformError.Check(input.ContextAuthority == study.ContextAuthority || !await db.Subjects.AnyAsync(x => x.StudyId == studyId), "AUTHORITY_MIGRATION_REQUIRED", "已有受試者時須透過受控遷移切換維護來源。");
        PlatformError.Check(input.RequiredMappings.Length <= 500 && input.RequiredMappings.All(x => x.StartsWith('/') && x.Length <= 250), "INVALID_MAPPING_SCOPE", "必要對應須使用欄位 JSON Pointer。");
        study.ContextAuthority = input.ContextAuthority; study.IcfCustody = input.IcfCustody;
        study.RequiredMappingsJson = JsonSerializer.Serialize(input.RequiredMappings.Distinct()); study.Active = input.Active;
        access.Evidence(studyId, null, actor.Id, "study.policy.changed", studyId, PlatformError.Text(input.Reason, "變更理由", 2000));
        await db.SaveChangesAsync(); return study;
    }
    public record GrantInput(Guid UserId, Guid? SiteId, bool CrossSite, Permission Permissions, DateTimeOffset? ExpiresAt, string Reason);
    [HttpPost("studies/{studyId:guid}/grants")]
    public async Task<object> Grant(Guid studyId, GrantInput input)
    {
        var actor = await access.Require(studyId, Permission.ManageStudy);
        PlatformError.Check(input.Permissions != Permission.None && (input.Permissions & ~Permission.All) == 0, "INVALID_PERMISSION", "權限無效。");
        PlatformError.Check(input.SiteId == null || await db.Sites.AnyAsync(x => x.Id == input.SiteId && x.StudyId == studyId), "SITE_MISMATCH", "院所不屬於研究。");
        PlatformError.Check(input.SiteId == null || !input.CrossSite, "INVALID_SCOPE", "院所指派不能同時宣告跨院。");
        PlatformError.Check(input.SiteId == null || (input.Permissions & (Permission.ManageStudy | Permission.Design | Permission.Publish)) == 0, "INVALID_SCOPE", "研究管理與表單設計／發布須使用研究層級指派。");
        PlatformError.Check(input.ExpiresAt == null || input.ExpiresAt > DateTimeOffset.UtcNow, "INVALID_EXPIRY", "到期時間必須在未來。");
        PlatformError.Check(await db.Users.AnyAsync(x => x.Id == input.UserId && x.Active), "USER_INVALID", "帳號不存在或已停用。");
        var target = await db.Users.FindAsync(input.UserId);
        if (target!.IntegrationSource != null) PlatformError.Check((input.Permissions & ~(Permission.Read | Permission.Collect | Permission.Export | Permission.Integrate)) == 0,
            "INTEGRATION_PERMISSION", "整合程式不能取得研究管理、核准、審閱或同意確認職責。");
        var grant = new AccessGrant { UserId = input.UserId, StudyId = studyId, SiteId = input.SiteId, CrossSite = input.CrossSite, Permissions = input.Permissions, ExpiresAt = input.ExpiresAt };
        db.Grants.Add(grant); access.Evidence(studyId, input.SiteId, actor.Id, "grant.created", grant.Id, PlatformError.Text(input.Reason, "授權理由", 2000));
        await db.SaveChangesAsync(); return grant;
    }
    [HttpGet("studies/{studyId:guid}/grants")]
    public async Task<object> Grants(Guid studyId)
    { await access.Require(studyId, Permission.ManageStudy); return await db.Grants.Where(x => x.StudyId == studyId).ToListAsync(); }
    public record ReasonInput(string Reason);
    [HttpPost("studies/{studyId:guid}/grants/{id:guid}/revoke")]
    public async Task<object> Revoke(Guid studyId, Guid id, ReasonInput input)
    {
        var actor = await access.Require(studyId, Permission.ManageStudy);
        var grant = await db.Grants.SingleOrDefaultAsync(x => x.Id == id && x.StudyId == studyId) ?? throw PlatformError.Missing();
        grant.ExpiresAt = DateTimeOffset.UtcNow; access.Evidence(studyId, grant.SiteId, actor.Id, "grant.revoked", id, PlatformError.Text(input.Reason, "撤銷理由", 2000));
        await db.SaveChangesAsync(); return new { revoked = true };
    }
    [HttpGet("studies/{studyId:guid}/sites")]
    public async Task<object> Sites(Guid studyId)
    {
        var actor = await access.Actor();
        if (await access.Can(actor.Id, studyId, Permission.ManageStudy)) return await db.Sites.Where(x => x.StudyId == studyId).ToListAsync();
        var ids = await access.Sites(studyId, Permission.Read); return await db.Sites.Where(x => ids.Contains(x.Id)).ToListAsync();
    }
    public record NewSite(string Code, string Name);
    [HttpPost("studies/{studyId:guid}/sites")]
    public async Task<object> CreateSite(Guid studyId, NewSite input)
    {
        var actor = await access.Require(studyId, Permission.ManageStudy);
        var site = new StudySite { StudyId = studyId, Code = PlatformError.Text(input.Code, "院所代碼", 80), Name = PlatformError.Text(input.Name, "院所名稱") };
        db.Sites.Add(site); access.Evidence(studyId, site.Id, actor.Id, "site.created", site.Id); await db.SaveChangesAsync(); return site;
    }
    [HttpGet("studies/{studyId:guid}/subjects")]
    public async Task<object> Subjects(Guid studyId)
    {
        var ids = await access.Sites(studyId, Permission.Read);
        return await db.Subjects.Where(x => x.StudyId == studyId && ids.Contains(x.SiteId)).OrderBy(x => x.Code).ToListAsync();
    }
    public record NewSubject(Guid SiteId, string Code);
    [HttpPost("studies/{studyId:guid}/subjects")]
    public async Task<object> CreateSubject(Guid studyId, NewSubject input)
    {
        var actor = await access.Require(studyId, Permission.Collect, input.SiteId);
        PlatformError.Check(await db.Sites.AnyAsync(x => x.Id == input.SiteId && x.StudyId == studyId && x.Active), "SITE_INVALID", "院所不屬於研究或已停用。");
        var study = await db.Studies.FindAsync(studyId) ?? throw PlatformError.Missing();
        PlatformError.Check(study.ContextAuthority == "platform", "CTMS_AUTHORITY", "此研究的脈絡由 CTMS 維護，不能手動建檔。");
        var subject = new Subject { StudyId = studyId, SiteId = input.SiteId, Code = PlatformError.Text(input.Code, "受試者研究代碼", 80) };
        db.Subjects.Add(subject); access.Evidence(studyId, input.SiteId, actor.Id, "subject.created", subject.Id); await db.SaveChangesAsync(); return subject;
    }
    public record NewVisitDefinition(string Code, string Name);
    [HttpPost("studies/{studyId:guid}/visit-definitions")]
    public async Task<object> CreateDefinition(Guid studyId, NewVisitDefinition input)
    {
        var actor = await access.Require(studyId, Permission.ManageStudy);
        var definition = new VisitDefinition { StudyId = studyId, Code = PlatformError.Text(input.Code, "訪視代碼", 80), Name = PlatformError.Text(input.Name, "訪視名稱") };
        db.VisitDefinitions.Add(definition); access.Evidence(studyId, null, actor.Id, "visit-definition.created", definition.Id); await db.SaveChangesAsync(); return definition;
    }
    [HttpGet("studies/{studyId:guid}/visit-definitions")]
    public async Task<object> Definitions(Guid studyId)
    {
        var actor = await access.Actor();
        if (!await db.Grants.AnyAsync(x => x.UserId == actor.Id && x.StudyId == studyId && (x.ExpiresAt == null || x.ExpiresAt > DateTimeOffset.UtcNow))) throw PlatformError.Missing();
        return await db.VisitDefinitions.Where(x => x.StudyId == studyId).ToListAsync();
    }
    public record NewVisit(Guid? DefinitionId, string Name, DateOnly Date, bool Unscheduled);
    [HttpPost("subjects/{subjectId:guid}/visits")]
    public async Task<object> CreateVisit(Guid subjectId, NewVisit input)
    {
        var subject = await access.Subject(subjectId, Permission.Collect); var actor = await access.Actor();
        var study = await db.Studies.FindAsync(subject.StudyId) ?? throw PlatformError.Missing();
        PlatformError.Check(study.ContextAuthority == "platform", "CTMS_AUTHORITY", "此研究由 CTMS 維護訪視，請使用具外部代碼與去重控制的端點。");
        PlatformError.Check(input.Unscheduled ? input.DefinitionId == null : input.DefinitionId != null, "VISIT_DEFINITION_REQUIRED", "預定訪視須選擇定義，非預定訪視不綁預定定義。");
        PlatformError.Check(input.DefinitionId == null || await db.VisitDefinitions.AnyAsync(x => x.Id == input.DefinitionId && x.StudyId == subject.StudyId), "VISIT_MISMATCH", "訪視定義不屬於研究。");
        var visit = new SubjectVisit { SubjectId = subjectId, DefinitionId = input.DefinitionId, Name = PlatformError.Text(input.Name, "訪視名稱"), Date = input.Date, Unscheduled = input.Unscheduled };
        db.Visits.Add(visit); access.Evidence(subject.StudyId, subject.SiteId, actor.Id, "visit.created", visit.Id); await db.SaveChangesAsync(); return visit;
    }
    [HttpGet("subjects/{subjectId:guid}/visits")]
    public async Task<object> Visits(Guid subjectId)
    { await access.Subject(subjectId, Permission.Read); return await db.Visits.Where(x => x.SubjectId == subjectId).OrderBy(x => x.Date).ToListAsync(); }
}
