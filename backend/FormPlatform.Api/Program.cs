using System.Security.Claims;
using FormPlatform.Api.Core;
using FormPlatform.Api.Data;
using FormPlatform.Api.Modules;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;
using Npgsql;

var builder = WebApplication.CreateBuilder(args);
var developmentIdentity = builder.Environment.IsDevelopment() && builder.Configuration.GetValue<bool>("Platform:DevelopmentIdentity");
var connection = builder.Configuration.GetConnectionString("Platform") ?? throw new InvalidOperationException("請設定 ConnectionStrings:Platform。");
builder.Services.AddDbContext<PlatformDb>(o => o.UseNpgsql(connection));
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<Access>();
builder.Services.AddScoped<ResponseWriter>();
builder.Services.AddScoped<WriteTransactionFilter>();
builder.Services.AddSingleton<ContractEngine>();
builder.Services.AddControllers(o => o.Filters.AddService<WriteTransactionFilter>()).AddJsonOptions(o => o.JsonSerializerOptions.MaxDepth = 48);
builder.Services.AddAuthorization();
if (developmentIdentity)
    builder.Services.AddAuthentication("Development").AddScheme<AuthenticationSchemeOptions, DevelopmentIdentity>("Development", _ => { });
else
{
    var authority = builder.Configuration["Authentication:Authority"];
    if (string.IsNullOrWhiteSpace(authority)) throw new InvalidOperationException("非開發模式必須設定受信任的 OIDC 身分供應商。");
    builder.Services.AddAuthentication(o => { o.DefaultScheme = "Platform"; o.DefaultSignInScheme = CookieAuthenticationDefaults.AuthenticationScheme; o.DefaultChallengeScheme = CookieAuthenticationDefaults.AuthenticationScheme; })
        .AddPolicyScheme("Platform", null, o => o.ForwardDefaultSelector = c => c.Request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? JwtBearerDefaults.AuthenticationScheme : CookieAuthenticationDefaults.AuthenticationScheme)
        .AddCookie(o =>
        {
            o.Cookie.Name = "__Host-formplatform"; o.Cookie.SecurePolicy = CookieSecurePolicy.Always;
            o.Cookie.HttpOnly = true; o.Cookie.SameSite = SameSiteMode.Lax;
            o.ExpireTimeSpan = TimeSpan.FromMinutes(30); o.SlidingExpiration = false;
            o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
        })
        .AddOpenIdConnect(o =>
        {
            o.Authority = authority; o.ClientId = builder.Configuration["Authentication:ClientId"];
            o.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
            o.ClientSecret = builder.Configuration["Authentication:ClientSecret"];
            o.ResponseType = "code"; o.UsePkce = true; o.SaveTokens = false; o.MapInboundClaims = false;
            o.Events.OnTokenValidated = c =>
            {
                var issuer = c.Principal?.FindFirst("iss")?.Value; var sub = c.Principal?.FindFirst("sub")?.Value;
                if (string.IsNullOrWhiteSpace(issuer) || string.IsNullOrWhiteSpace(sub)) c.Fail("缺少受信任身分識別。");
                else ((ClaimsIdentity)c.Principal!.Identity!).AddClaim(new Claim(ClaimTypes.NameIdentifier, issuer + "|" + sub));
                return Task.CompletedTask;
            };
            o.Events.OnRedirectToIdentityProvider = c =>
            {
                if (c.Properties.Items.TryGetValue("reauth", out var reauth) && reauth == "true")
                { c.ProtocolMessage.Prompt = "login"; c.ProtocolMessage.MaxAge = "0"; }
                return Task.CompletedTask;
            };
            o.Events.OnRedirectToIdentityProviderForSignOut = c =>
            {
                // No access/refresh/ID token is persisted in the browser session.
                // Supply client_id so providers can validate the configured post-logout URI.
                c.ProtocolMessage.ClientId = c.Options.ClientId;
                return Task.CompletedTask;
            };
        });
    builder.Services.AddAuthentication().AddJwtBearer(o =>
    {
        o.Authority = authority; o.Audience = builder.Configuration["Authentication:ApiAudience"] ?? builder.Configuration["Authentication:ClientId"];
        o.RequireHttpsMetadata = !builder.Environment.IsDevelopment(); o.MapInboundClaims = false;
        o.Events = new JwtBearerEvents
        {
            OnTokenValidated = c =>
            {
                var issuer = c.Principal?.FindFirst("iss")?.Value; var sub = c.Principal?.FindFirst("sub")?.Value;
                if (string.IsNullOrWhiteSpace(issuer) || string.IsNullOrWhiteSpace(sub)) c.Fail("缺少受信任系統身分。");
                else { ((ClaimsIdentity)c.Principal!.Identity!).AddClaim(new Claim(ClaimTypes.NameIdentifier, issuer + "|" + sub)); c.HttpContext.Items["PlatformBearer"] = true; }
                return Task.CompletedTask;
            }
        };
    });
    builder.Services.AddAntiforgery(o => o.HeaderName = "X-CSRF-Token");
}
var app = builder.Build();
var frameOrigins = builder.Configuration.GetSection("Embedding:AllowedOrigins").Get<string[]>() ?? [];
foreach (var origin in frameOrigins)
{
    if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri) || uri.GetLeftPart(UriPartial.Authority) != origin ||
        uri.Scheme != "https" && !(app.Environment.IsDevelopment() && uri.Scheme == "http" && uri.IsLoopback))
        throw new InvalidOperationException("Embedding:AllowedOrigins 必須是無路徑的 HTTPS origin；不接受萬用字元。");
}
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store"; context.Response.Headers.XContentTypeOptions = "nosniff";
    context.Response.Headers.ContentSecurityPolicy = "frame-ancestors 'self' " + string.Join(' ', frameOrigins) + ";";
    try { await next(); }
    catch (Exception exception) when (!context.Response.HasStarted)
    {
        var error = exception switch
        {
            PlatformError known => known,
            DbUpdateConcurrencyException => new PlatformError(409, "REVISION_CONFLICT", "紀錄已變更，請重新載入。"),
            DbUpdateException { InnerException: PostgresException { SqlState: "23505" } } => new PlatformError(409, "DUPLICATE", "代碼或紀錄已存在。"),
            PostgresException { SqlState: "40001" or "40P01" } => new PlatformError(409, "TRANSACTION_CONFLICT", "同時修改發生衝突，請重新載入後重試。"),
            DbUpdateException { InnerException: PostgresException { SqlState: "40001" or "40P01" } } => new PlatformError(409, "TRANSACTION_CONFLICT", "同時修改發生衝突，請重新載入後重試。"),
            System.Text.Json.JsonException => PlatformError.Invalid("INVALID_JSON", "資料不是有效 JSON。"),
            Microsoft.AspNetCore.Antiforgery.AntiforgeryValidationException => new PlatformError(400, "CSRF_INVALID", "請重新載入頁面後操作。"),
            _ => new PlatformError(500, "INTERNAL_ERROR", "伺服器無法完成操作，請提供追蹤編號給管理人員。")
        };
        if (error.Status == 500) app.Logger.LogError("Operation failed ({ExceptionType}); trace {TraceId}", exception.GetType().Name, context.TraceIdentifier);
        context.Response.StatusCode = error.Status;
        await context.Response.WriteAsJsonAsync(new { type = "about:blank", title = error.Message, status = error.Status, code = error.Code, details = error.Details, traceId = context.TraceIdentifier });
    }
});
if (!app.Environment.IsDevelopment()) { app.UseHsts(); app.UseHttpsRedirection(); }
app.UseAuthentication(); app.UseAuthorization();
if (!developmentIdentity)
{
    app.Use(async (c, next) =>
    {
        if (c.Request.Path.StartsWithSegments("/api") && c.Items["PlatformBearer"] is not true && !HttpMethods.IsGet(c.Request.Method) && !HttpMethods.IsHead(c.Request.Method))
            await c.RequestServices.GetRequiredService<Microsoft.AspNetCore.Antiforgery.IAntiforgery>().ValidateRequestAsync(c);
        await next();
    });
    app.MapGet("/auth/login", (bool? reauth) => Results.Challenge(new AuthenticationProperties { RedirectUri = "/platform.html", Items = { ["reauth"] = reauth == true ? "true" : "false" } }, [OpenIdConnectDefaults.AuthenticationScheme]));
    app.MapPost("/api/auth/logout", () => Results.SignOut(new AuthenticationProperties { RedirectUri = "/platform.html" }, [CookieAuthenticationDefaults.AuthenticationScheme, OpenIdConnectDefaults.AuthenticationScheme]));
    app.MapGet("/api/csrf", (HttpContext c, Microsoft.AspNetCore.Antiforgery.IAntiforgery a) => Results.Ok(new { token = a.GetAndStoreTokens(c).RequestToken })).RequireAuthorization();
}
app.MapGet("/api/runtime", () => new { developmentIdentity, syntheticOnly = app.Environment.IsDevelopment(), embeddingOrigins = frameOrigins });
if (developmentIdentity) app.MapGet("/api/development/accounts", () => DevelopmentSeed.Accounts.Select(x => new { subject = x.Key, name = x.Value }));
app.MapGet("/health/ready", async (PlatformDb db) => await db.Database.CanConnectAsync() ? Results.Ok(new { status = "healthy" }) : Results.StatusCode(503));
app.MapControllers();
var staticDirectory = app.Environment.IsDevelopment() && builder.Configuration["Platform:DevelopmentStaticDirectory"] is string configuredDirectory
    ? Path.GetFullPath(configuredDirectory, app.Environment.ContentRootPath) : Path.Combine(app.Environment.ContentRootPath, "wwwroot");
if (Directory.Exists(staticDirectory)) app.UseStaticFiles(new StaticFileOptions { FileProvider = new PhysicalFileProvider(staticDirectory) });
app.MapGet("/", () => Results.Redirect("/platform.html"));
if (app.Environment.IsDevelopment() || args.Contains("--migrate"))
{
    await using var scope = app.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<PlatformDb>();
    await db.Database.MigrateAsync(); if (developmentIdentity) await DevelopmentSeed.Seed(db);
    if (app.Environment.IsDevelopment() && builder.Configuration.GetValue<bool>("Platform:DevelopmentOidcSeed"))
        await DevelopmentSeed.SeedOidc(db, builder.Configuration["Authentication:Authority"] ?? "");
}
if (args.Contains("--migrate")) return;
if (args.Contains("--bootstrap-operator"))
{
    await using var scope = app.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<PlatformDb>();
    await db.Database.MigrateAsync();
    if (await db.Users.AnyAsync(x => x.IsOperator)) throw new InvalidOperationException("已有平台管理員，須由現任管理員透過受控帳號流程處理。");
    db.Users.Add(new PlatformUser { IdentitySubject = PlatformError.Text(builder.Configuration["Platform:BootstrapIdentitySubject"], "初始管理員身分", 1000),
        Name = PlatformError.Text(builder.Configuration["Platform:BootstrapName"], "初始管理員名稱"), IsOperator = true });
    await db.SaveChangesAsync(); app.Logger.LogInformation("初始管理員已建立，尚未授予任何研究內容權限。"); return;
}
app.Run();
public partial class Program;
