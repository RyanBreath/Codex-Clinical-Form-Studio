using FormPlatform.Api.Data;
using Microsoft.EntityFrameworkCore;
namespace FormPlatform.Api.Core;
public static class DevelopmentSeed
{
    public static readonly IReadOnlyDictionary<string, string> Accounts = new Dictionary<string, string>
    {
        ["dev-operator"] = "開發管理員", ["dev-designer"] = "表單設計者", ["dev-reviewer"] = "獨立核准／審閱者",
        ["dev-site-a"] = "甲院研究人員", ["dev-site-b"] = "乙院研究人員", ["dev-ctms"] = "CTMS 合成整合程式"
    };
    public static async Task Seed(PlatformDb db)
    {
        foreach (var (key, name) in Accounts)
            if (!await db.Users.AnyAsync(x => x.IdentitySubject == key))
                db.Users.Add(new PlatformUser { IdentitySubject = key, Name = name, IsOperator = key == "dev-operator", IntegrationSource = key == "dev-ctms" ? "ctms-demo" : null });
        await db.SaveChangesAsync();
    }
    public static async Task SeedOidc(PlatformDb db, string authority)
    {
        if (!Uri.TryCreate(authority, UriKind.Absolute, out var uri) || !uri.IsLoopback || uri.AbsolutePath != "/realms/form-platform")
            throw new InvalidOperationException("OIDC 合成資料只可用於指定的本機測試 realm。");
        var users = new[] { ("11111111-1111-4111-8111-111111111111", "平台管理員（SSO）", true),
            ("22222222-2222-4222-8222-222222222222", "研究填寫者（SSO）", false),
            ("33333333-3333-4333-8333-333333333333", "研究核准者（SSO）", false) };
        foreach (var (sub, name, isOperator) in users)
        {
            var identity = authority.TrimEnd('/') + "|" + sub;
            if (!await db.Users.AnyAsync(x => x.IdentitySubject == identity)) db.Users.Add(new PlatformUser { IdentitySubject = identity, Name = name, IsOperator = isOperator });
        }
        await db.SaveChangesAsync();
    }
}
