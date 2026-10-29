using System.Security.Claims;
using System.Text.Json;
using FormPlatform.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace FormPlatform.Api.Core;

public sealed class Access(PlatformDb db, IHttpContextAccessor context, IHostEnvironment environment)
{
    public async Task<PlatformUser> Actor()
    {
        var subject = context.HttpContext?.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (subject is null) throw new PlatformError(401, "LOGIN_REQUIRED", "請先登入。");
        return await db.Users.SingleOrDefaultAsync(x => x.IdentitySubject == subject && x.Active)
            ?? throw new PlatformError(403, "ACCOUNT_NOT_AUTHORIZED", "帳號尚未授權或已停用。");
    }

    public async Task<PlatformUser> Require(Guid studyId, Permission permission, Guid? siteId = null)
    {
        var actor = await Actor();
        if (actor.IntegrationSource != null && (permission & Permission.Collect) != 0)
            permission |= Permission.Integrate;
        if (!await Can(actor.Id, studyId, permission, siteId)) throw PlatformError.Missing();
        if ((permission & (Permission.ManageStudy | Permission.Publish | Permission.Lock | Permission.ConfirmBasis | Permission.ReadIcf | Permission.Export)) != 0)
            RequireRecentMfa(actor);
        return actor;
    }

    public async Task<PlatformUser> RequireOperator()
    {
        var actor = await Actor(); if (!actor.IsOperator || actor.IntegrationSource != null) throw PlatformError.Missing();
        RequireRecentMfa(actor); return actor;
    }
    private void RequireRecentMfa(PlatformUser actor)
    {
        if (environment.IsDevelopment() || actor.IntegrationSource != null) return;
        var user = context.HttpContext!.User;
        var methods = user.FindAll("amr").SelectMany(claim =>
        {
            try { return JsonSerializer.Deserialize<string[]>(claim.Value) ?? []; }
            catch (JsonException) { return new[] { claim.Value }; }
        }).ToArray();
        var recent = long.TryParse(user.FindFirstValue("auth_time"), out var time) &&
            DateTimeOffset.UtcNow.ToUnixTimeSeconds() - time is >= 0 and <= 900;
        var hasMfa = methods.Contains("mfa") || methods.Contains("pwd") && methods.Any(m => m is "otp" or "hwk");
        if (!hasMfa || !recent)
            throw new PlatformError(403, "RECENT_MFA_REQUIRED", "此操作須先完成近期多因素身分驗證。");
    }

    public async Task<bool> Can(Guid actorId, Guid studyId, Permission permission, Guid? siteId = null)
    {
        var permissions = await db.Grants.Where(x => x.UserId == actorId && x.StudyId == studyId &&
            (x.ExpiresAt == null || x.ExpiresAt > DateTimeOffset.UtcNow) &&
            (siteId == null ? x.SiteId == null : x.SiteId == siteId || (x.SiteId == null && x.CrossSite))).Select(x => x.Permissions).ToListAsync();
        return (permissions.Aggregate(Permission.None, (combined, current) => combined | current) & permission) == permission;
    }

    public async Task<Guid[]> Sites(Guid studyId, Permission permission)
    {
        var actor = await Actor();
        var grants = await db.Grants.Where(x => x.UserId == actor.Id && x.StudyId == studyId &&
            (x.ExpiresAt == null || x.ExpiresAt > DateTimeOffset.UtcNow)).ToListAsync();
        var sites = await db.Sites.Where(x => x.StudyId == studyId).Select(x => x.Id).ToListAsync();
        return sites.Where(site => (grants.Where(g => g.SiteId == site || g.SiteId == null && g.CrossSite)
            .Aggregate(Permission.None, (combined, grant) => combined | grant.Permissions) & permission) == permission).ToArray();
    }

    public async Task<Subject> Subject(Guid id, Permission permission)
    {
        var subject = await db.Subjects.SingleOrDefaultAsync(x => x.Id == id) ?? throw PlatformError.Missing();
        await Require(subject.StudyId, permission, subject.SiteId);
        return subject;
    }

    public async Task CollectionAllowed(Subject subject, string purpose = "research")
    {
        PlatformError.Check(await db.Studies.AnyAsync(x => x.Id == subject.StudyId && x.Active) &&
            await db.Sites.AnyAsync(x => x.Id == subject.SiteId && x.Active), "COLLECTION_INACTIVE", "研究或院所已停用。");
        var bases = await db.Bases.Where(x => x.SubjectId == subject.Id && x.Purpose == purpose && x.State == "confirmed").ToListAsync();
        foreach (var basis in bases)
        {
            if (basis.IcfVersionId == null && basis.Kind == "waiver") return;
            if (basis.IcfVersionId is Guid icfId && await db.Icfs.AnyAsync(x => x.Id == icfId && x.Active && x.State == "published" &&
                x.StudyId == subject.StudyId && (x.SiteId == null || x.SiteId == subject.SiteId))) return;
        }
        throw new PlatformError(409, "COLLECTION_BASIS_REQUIRED", "適用的同意或免同意依據尚未確認，禁止研究資料輸入與附件上傳。");
    }

    public void Evidence(Guid study, Guid? site, Guid actor, string action, Guid resource, string reason = "", object? payload = null)
    {
        db.Audit.Add(new AuditEvent { StudyId = study, SiteId = site, ActorId = actor, Action = action, Resource = resource.ToString(), Reason = reason });
        db.Outbox.Add(new OutboxEvent { StudyId = study, SiteId = site, Type = action,
            PayloadJson = JsonSerializer.Serialize(payload ?? new { resourceId = resource }) });
    }
}
