using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using FormPlatform.Api.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;

namespace FormPlatform.IntegrationTests;

public sealed class BearerAuthenticationTests(PlatformFixture fixture) : IClassFixture<PlatformFixture>
{
    [Fact]
    public async Task Signed_service_tokens_validate_issuer_audience_and_account_revocation()
    {
        using var rsa = RSA.Create(2048); var key = new RsaSecurityKey(rsa) { KeyId = "mvp-test-key" };
        const string issuer = "https://issuer.synthetic.invalid"; const string audience = "form-platform";
        var subject = Guid.NewGuid().ToString();
        await using var scope = fixture.App.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<PlatformDb>();
        var account = new PlatformUser { IdentitySubject = issuer + "|" + subject, Name = "JWT 合成整合程式", IntegrationSource = "jwt-synthetic" };
        db.Users.Add(account); await db.SaveChangesAsync();
        await using var app = fixture.App.WithWebHostBuilder(builder => builder.UseSetting("Platform:DevelopmentIdentity", "false")
            .UseSetting("Authentication:Authority", issuer).UseSetting("Authentication:ClientId", audience)
            .ConfigureServices(services => services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
            {
                var configuration = new OpenIdConnectConfiguration { Issuer = issuer }; configuration.SigningKeys.Add(key);
                options.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(configuration);
                options.TokenValidationParameters.ValidIssuer = issuer; options.TokenValidationParameters.ValidAudience = audience;
                options.TokenValidationParameters.ClockSkew = TimeSpan.Zero;
            })));
        using var client = app.CreateClient();
        string Token(string tokenIssuer, string tokenAudience) => new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        { Issuer = tokenIssuer, Audience = tokenAudience, Subject = new ClaimsIdentity([new Claim("sub", subject)]),
            Expires = DateTime.UtcNow.AddMinutes(5), SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.RsaSha256) });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(issuer, "wrong-audience"));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me")).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token("https://wrong.synthetic.invalid", audience));
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me")).StatusCode);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", Token(issuer, audience));
        var me = await client.GetFromJsonAsync<JsonNode>("/api/me"); Assert.Equal(account.Id.ToString(), me!["id"]!.GetValue<string>());
        // A valid service token reaches resource authorization without a browser CSRF cookie.
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/integrations/responses", new { occurrenceId = Guid.NewGuid(), externalRecordId = "synthetic", data = new { } })).StatusCode);
        var originalRevision = account.Revision;
        account.Active = false; await db.SaveChangesAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/me")).StatusCode);
        Assert.True(account.Revision > originalRevision);
    }
}
