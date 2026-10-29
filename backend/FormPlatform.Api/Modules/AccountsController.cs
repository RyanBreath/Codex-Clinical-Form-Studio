using FormPlatform.Api.Core;
using FormPlatform.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
namespace FormPlatform.Api.Modules;

[ApiController, Authorize, Route("api/admin/users")]
public sealed class AccountsController(PlatformDb db, Access access) : ControllerBase
{
    [HttpGet]
    public async Task<object> List()
    {
        await access.RequireOperator();
        return await db.Users.OrderBy(x => x.Name).Select(x => new { x.Id, x.Revision, x.IdentitySubject, x.Name, x.Active, x.IntegrationSource, x.IsOperator }).ToListAsync();
    }
    public record UserInput(string IdentitySubject, string Name, string? IntegrationSource);
    [HttpPost]
    public async Task<object> Register(UserInput input)
    {
        await access.RequireOperator();
        var identity = PlatformError.Text(input.IdentitySubject, "供應商 issuer|subject", 1000);
        PlatformError.Check(identity.Contains('|'), "IDENTITY_FORMAT", "正式帳號須使用受信任供應商 issuer 與 subject 的明確組合，不依 Email 自動連結。");
        var user = new PlatformUser { IdentitySubject = identity, Name = PlatformError.Text(input.Name, "名稱"),
            IntegrationSource = input.IntegrationSource == null ? null : PlatformError.Text(input.IntegrationSource, "整合來源", 80) };
        db.Users.Add(user);
        var actor = await access.Actor();
        db.Audit.Add(new AuditEvent { ActorId = actor.Id, Action = "account.created", Resource = user.Id.ToString(), Reason = "明確註冊受信任供應商身分，未自動授予研究權限" });
        await db.SaveChangesAsync(); return new { user.Id, user.Name, user.Active, user.IntegrationSource };
    }
    public record UserState(long ExpectedRevision, bool Active, string Reason);
    [HttpPut("{id:guid}/state")]
    public async Task<object> ChangeState(Guid id, UserState input)
    {
        var actor = await access.RequireOperator(); var user = await db.Users.FindAsync(id) ?? throw PlatformError.Missing();
        PlatformError.Revision(input.ExpectedRevision, user.Revision);
        PlatformError.Check(user.Id != actor.Id || input.Active, "SELF_DISABLE", "不能停用目前操作中的平台管理員。");
        user.Active = input.Active;
        // Global account administration evidence uses an empty study scope, separate from study content access.
        db.Audit.Add(new AuditEvent { ActorId = actor.Id, Action = "account.state.changed", Resource = id.ToString(), Reason = PlatformError.Text(input.Reason, "帳號變更理由", 2000) });
        await db.SaveChangesAsync(); return new { user.Id, user.Active, user.Revision };
    }
}
