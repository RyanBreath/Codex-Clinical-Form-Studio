using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using FormPlatform.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace FormPlatform.IntegrationTests;

public sealed class PlatformFixture : IAsyncLifetime
{
    private readonly string database = "formplatform_test_" + Guid.NewGuid().ToString("N");
    public WebApplicationFactory<Program> App { get; private set; } = null!;
    public async Task InitializeAsync()
    {
        await using var connection = new NpgsqlConnection("Host=127.0.0.1;Port=25432;Database=formplatform;Username=formplatform;Password=local-development-only");
        await connection.OpenAsync(); await using var command = new NpgsqlCommand($"CREATE DATABASE \"{database}\"", connection); await command.ExecuteNonQueryAsync();
        App = new WebApplicationFactory<Program>().WithWebHostBuilder(b => b.UseEnvironment("Development")
            .UseSetting("ConnectionStrings:Platform", $"Host=127.0.0.1;Port=25432;Database={database};Username=formplatform;Password=local-development-only")
            .UseSetting("Platform:DevelopmentIdentity", "true"));
        using var client = Client(); Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/health/ready")).StatusCode);
    }
    public HttpClient Client(string user = "dev-operator")
    { var client = App.CreateClient(); client.DefaultRequestHeaders.Add("X-Development-User", user); return client; }
    public async Task DisposeAsync()
    {
        await App.DisposeAsync(); NpgsqlConnection.ClearAllPools();
        await using var connection = new NpgsqlConnection("Host=127.0.0.1;Port=25432;Database=formplatform;Username=formplatform;Password=local-development-only");
        await connection.OpenAsync(); await using var command = new NpgsqlCommand($"DROP DATABASE \"{database}\" WITH (FORCE)", connection); await command.ExecuteNonQueryAsync();
    }
}

public sealed class PlatformTests(PlatformFixture fixture) : IClassFixture<PlatformFixture>
{
    private static Guid Id(JsonNode node) => Guid.Parse(node["id"]!.GetValue<string>());
    private static long Revision(JsonNode node) => node["revision"]!.GetValue<long>();
    private static async Task<JsonNode> Post(HttpClient client, string url, object input)
    {
        var result = await client.PostAsJsonAsync(url, input); var body = await result.Content.ReadAsStringAsync();
        Assert.True(result.IsSuccessStatusCode, $"POST {url}: {result.StatusCode} {body}"); return JsonNode.Parse(body)!;
    }
    private static async Task<JsonNode> Get(HttpClient client, string url)
    { var result = await client.GetAsync(url); result.EnsureSuccessStatusCode(); return (await result.Content.ReadFromJsonAsync<JsonNode>())!; }
    private async Task<(Guid Study, Guid A, Guid B)> Study()
    {
        using var client = fixture.Client(); var study = Id(await Post(client, "/api/studies", new { code = "S-" + Guid.NewGuid().ToString("N"), name = "合成多院研究" }));
        var a = Id(await Post(client, $"/api/studies/{study}/sites", new { code = "A", name = "甲院" }));
        var b = Id(await Post(client, $"/api/studies/{study}/sites", new { code = "B", name = "乙院" }));
        var users = (await Get(client, "/api/users")).AsArray();
        var memberships = new[] { ("甲院研究人員", (Guid?)a, false, Permission.Read | Permission.Collect),
            ("乙院研究人員", (Guid?)b, false, Permission.Read | Permission.Collect),
            ("表單設計者", (Guid?)null, false, Permission.Design | Permission.Read),
            ("獨立核准／審閱者", (Guid?)null, true, Permission.Publish | Permission.Read | Permission.Review | Permission.Lock | Permission.ConfirmBasis | Permission.Export) };
        foreach (var (name, site, crossSite, permissions) in memberships)
            await Post(client, $"/api/studies/{study}/grants", new { userId = Id(users.Single(x => x!["name"]!.GetValue<string>() == name)!), siteId = site, crossSite, permissions, reason = "合成案例授權" });
        return (study, a, b);
    }
    private static JsonObject Contract() => JsonNode.Parse("""
    {
      "$schema":"https://json-schema.org/draft/2020-12/schema", "$id":"https://example.test/forms/vitals/1.0.0",
      "type":"object", "additionalProperties":false, "properties":{
        "weight":{"type":"number","minimum":1,"maximum":300},
        "height":{"type":"number","minimum":30,"maximum":250},
        "bmi":{"type":"number","readOnly":true},
        "symptom":{"type":"boolean"}, "detail":{"type":"string","maxLength":50}
      },"required":["weight","height"],
      "x-airwayai":{"contractVersion":"1.2.0","formId":"vitals","schemaVersion":"1.0.0","status":"draft",
        "defaultLocale":"zh-TW","locales":["zh-TW"],"title":{"zh-TW":"生命徵象"},
        "fields":{
          "/weight":{"label":{"zh-TW":"體重"},"widget":"number","coding":{"status":"unresolved"}},
          "/height":{"label":{"zh-TW":"身高"},"widget":"number","coding":{"status":"unresolved"}},
          "/bmi":{"label":{"zh-TW":"BMI"},"widget":"computed","coding":{"status":"unresolved"}},
          "/symptom":{"label":{"zh-TW":"有症狀"},"widget":"boolean","coding":{"status":"unresolved"}},
          "/detail":{"label":{"zh-TW":"說明"},"widget":"text","visibleWhen":{"op":"eq","path":"/symptom","value":true},"requiredWhen":{"op":"eq","path":"/symptom","value":true},"coding":{"status":"unresolved"}}
        },"layout":[{"type":"section","id":"main","title":{"zh-TW":"生命徵象"},"items":[{"type":"field","path":"/weight"},{"type":"field","path":"/height"},{"type":"field","path":"/bmi"},{"type":"field","path":"/symptom"},{"type":"field","path":"/detail"}]}],
        "computed":{"/bmi":{"op":"divide","args":[{"op":"path","path":"/weight"},{"op":"multiply","args":[{"op":"divide","args":[{"op":"path","path":"/height"},{"op":"value","value":100}]},{"op":"divide","args":[{"op":"path","path":"/height"},{"op":"value","value":100}]}]}]}}
      }
    }
    """)!.AsObject();
    private async Task<(Guid Subject, Guid Visit, JsonNode Basis)> Subject(Guid study, Guid site, bool confirmed = true)
    {
        using var writer = fixture.Client("dev-site-a"); using var reviewer = fixture.Client("dev-reviewer");
        var subject = Id(await Post(writer, $"/api/studies/{study}/subjects", new { siteId = site, code = "SUB-" + Guid.NewGuid().ToString("N") }));
        var basis = await Post(writer, $"/api/subjects/{subject}/collection-bases", new { kind = "waiver", reference = "合成免同意核准依據", purpose = "research" });
        if (confirmed) basis = await Post(reviewer, $"/api/collection-bases/{Id(basis)}/confirm", new { expectedRevision = Revision(basis), reason = "核對合成核准範圍" });
        var visit = Id(await Post(writer, $"/api/subjects/{subject}/visits", new { name = "非預定訪視", date = "2026-10-28", unscheduled = true }));
        return (subject, visit, basis);
    }
    private async Task<(Guid Version, Guid Adoption)> Published(Guid study)
    {
        using var designer = fixture.Client("dev-designer"); using var reviewer = fixture.Client("dev-reviewer");
        var template = Id(await Post(designer, $"/api/studies/{study}/templates", new { name = "生命徵象", kind = "ecrf" }));
        var version = await Post(designer, $"/api/templates/{template}/versions", new { version = "1.0.0", contract = Contract(), sourceYaml = "" });
        version = await Post(designer, $"/api/form-versions/{Id(version)}/submit", new { expectedRevision = Revision(version), reason = "送審" });
        version = await Post(reviewer, $"/api/form-versions/{Id(version)}/publish", new { expectedRevision = Revision(version), reason = "獨立核准" });
        var adoption = Id(await Post(reviewer, $"/api/studies/{study}/adoptions", new { formVersionId = Id(version), maximumOccurrences = 2, reason = "研究採用" }));
        return (Id(version), adoption);
    }

    [Fact]
    public async Task Embedded_context_and_library_preserve_research_and_site_authorization()
    {
        var (study, a, _) = await Study(); var (_, visit, _) = await Subject(study, a); var (_, adoption) = await Published(study);
        using var writer = fixture.Client("dev-site-a"); using var other = fixture.Client("dev-site-b");
        var occurrence = await Post(writer, $"/api/visits/{visit}/occurrences", new { adoptionId = adoption, number = 1 });
        var context = await Get(writer, $"/api/occurrences/{Id(occurrence)}/context"); Assert.True(context["canCollect"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/occurrences/{Id(occurrence)}/context")).StatusCode);
        using var reader = fixture.Client("dev-reviewer"); var readContext = await Get(reader, $"/api/occurrences/{Id(occurrence)}/context"); Assert.False(readContext["canCollect"]!.GetValue<bool>());
        var library = (await Get(writer, "/api/template-library")).AsArray();
        Assert.Contains(library, x => x!["version"]!.GetValue<string>() == "1.0.0");
        using var unassigned = fixture.Client("dev-ctms");
        // Integration grants from other studies do not expose this study's template.
        Assert.DoesNotContain((await Get(unassigned, "/api/template-library")).AsArray(), x => x!["versionId"]!.GetValue<string>() == context["formVersionId"]!.GetValue<string>());
    }

    [Fact]
    public async Task Icf_draft_requires_independent_approval_and_retirement_stops_collection()
    {
        var (study, a, _) = await Study();
        using var author = fixture.Client(); using var reviewer = fixture.Client("dev-reviewer");
        using var collector = fixture.Client("dev-site-a"); using var other = fixture.Client("dev-site-b");
        var subject = Id(await Post(collector, $"/api/studies/{study}/subjects", new { siteId = a, code = "ICF-SUB-001" }));
        var icf = await Post(author, $"/api/studies/{study}/icfs", new { siteId = a, name = "受試者同意書", version = "1.0", locale = "zh-TW", content = "合成 ICF 內容", approvalReference = "SYNTH-IRB-001" });
        Assert.Equal("draft", icf["state"]!.GetValue<string>());
        Assert.Empty((await Get(collector, $"/api/studies/{study}/icfs")).AsArray());
        var basisInput = new { kind = "consent", reference = "院端合成簽署文件", icfVersionId = Id(icf), signedOn = "2026-01-01", purpose = "research" };
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await collector.PostAsJsonAsync($"/api/subjects/{subject}/collection-bases", basisInput)).StatusCode);
        icf = await Post(author, $"/api/icfs/{Id(icf)}/workflow/submit", new { expectedRevision = Revision(icf), reason = "送交獨立核准" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await author.PostAsJsonAsync($"/api/icfs/{Id(icf)}/workflow/approve", new { expectedRevision = Revision(icf), reason = "禁止自審" })).StatusCode);
        icf = await Post(reviewer, $"/api/icfs/{Id(icf)}/workflow/approve", new { expectedRevision = Revision(icf), reason = "核對外部 IRB 核准文件" });
        Assert.False(string.IsNullOrWhiteSpace(icf["approvalHash"]!.GetValue<string>()));
        Assert.Empty((await Get(other, $"/api/studies/{study}/icfs")).AsArray());
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await author.PutAsJsonAsync($"/api/icfs/{Id(icf)}/draft", new { expectedRevision = Revision(icf), name = "改名", version = "2", locale = "zh-TW", content = "不可改", approvalReference = "SYNTH", reason = "不可覆寫" })).StatusCode);
        var basis = await Post(collector, $"/api/subjects/{subject}/collection-bases", basisInput);
        await Post(reviewer, $"/api/collection-bases/{Id(basis)}/confirm", new { expectedRevision = Revision(basis), reason = "已核對院端簽署證據" });
        var visit = Id(await Post(collector, $"/api/subjects/{subject}/visits", new { name = "ICF 測試訪視", date = "2026-01-01", unscheduled = true }));
        var (_, adoption) = await Published(study);
        var occurrence = Id(await Post(collector, $"/api/visits/{visit}/occurrences", new { adoptionId = adoption, number = 1 }));
        await Post(reviewer, $"/api/icfs/{Id(icf)}/retire", new { expectedRevision = Revision(icf), reason = "後續須重新取得新版同意" });
        Assert.Equal(HttpStatusCode.Conflict, (await collector.PostAsJsonAsync($"/api/occurrences/{occurrence}/responses", new { data = new { weight = 65, height = 170 } })).StatusCode);
    }

    [Fact]
    public async Task Account_administration_is_operator_only_and_never_auto_grants_studies()
    {
        using var admin = fixture.Client(); using var collector = fixture.Client("dev-site-a");
        Assert.Equal(HttpStatusCode.NotFound, (await collector.GetAsync("/api/admin/users")).StatusCode);
        var account = await Post(admin, "/api/admin/users", new { identitySubject = "https://identity.example|" + Guid.NewGuid(), name = "新研究人員", integrationSource = (string?)null });
        var accounts = (await Get(admin, "/api/admin/users")).AsArray(); var row = accounts.Single(x => Id(x!) == Id(account))!;
        await PostAccountState(admin, Id(row), Revision(row), false);
        await using var scope = fixture.App.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<PlatformDb>();
        Assert.False(await db.Grants.AnyAsync(x => x.UserId == Id(account)));
        var me = await Get(admin, "/api/me"); var own = accounts.Single(x => Id(x!) == Id(me))!;
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await admin.PutAsJsonAsync($"/api/admin/users/{Id(own)}/state", new { expectedRevision = Revision(own), active = false, reason = "不能停用自己" })).StatusCode);
    }
    private static async Task PostAccountState(HttpClient client, Guid id, long revision, bool active)
    { var result = await client.PutAsJsonAsync($"/api/admin/users/{id}/state", new { expectedRevision = revision, active, reason = "合成帳號狀態驗收" }); result.EnsureSuccessStatusCode(); }

    [Fact]
    public async Task New_version_requires_matching_number_and_distinct_contract_identity()
    {
        var (study, _, _) = await Study(); using var designer = fixture.Client("dev-designer");
        var template = Id(await Post(designer, $"/api/studies/{study}/templates", new { name = "版本一致性", kind = "ecrf" }));
        var endpoint = $"/api/templates/{template}/versions";
        var first = await Post(designer, endpoint, new { version = "1.0.0", contract = Contract(), sourceYaml = "" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await designer.PostAsJsonAsync(endpoint, new { version = "2.0.0", contract = Contract(), sourceYaml = "" })).StatusCode);
        var next = Contract(); next["x-airwayai"]!["schemaVersion"] = "2.0.0";
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await designer.PostAsJsonAsync(endpoint, new { version = "2.0.0", contract = next, sourceYaml = "" })).StatusCode);
        next["$id"] = "https://example.test/forms/vitals/2.0.0";
        next["properties"]!["weight"]!["maximum"] = 200;
        var second = await Post(designer, endpoint, new { version = "2.0.0", contract = next, sourceYaml = "" });
        var original = await Get(designer, $"/api/form-versions/{Id(first)}");
        Assert.Equal(first["contentHash"]!.GetValue<string>(), original["contentHash"]!.GetValue<string>());
        Assert.Equal("2.0.0", second["version"]!.GetValue<string>());
        var diff = await Get(designer, $"/api/form-versions/{Id(first)}/diff/{Id(second)}");
        Assert.Contains(diff["contractChanges"]!.AsArray(), x => x!["path"]!.GetValue<string>() == "/properties/weight/maximum" && x["before"]!.GetValue<int>() == 300 && x["after"]!.GetValue<int>() == 200);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await designer.PutAsJsonAsync($"/api/form-versions/{Id(first)}", new { expectedRevision = Revision(first), contract = next, sourceYaml = "", reason = "不可將既有版本換成另一版" })).StatusCode);
    }

    [Fact]
    public async Task Not_done_requires_reason_and_scoped_revision_then_resume_preserves_audit()
    {
        var (study, a, _) = await Study(); var (_, visit, _) = await Subject(study, a);
        var (_, adoption) = await Published(study);
        using var writer = fixture.Client("dev-site-a"); using var other = fixture.Client("dev-site-b");
        using var reviewer = fixture.Client("dev-reviewer");
        var occurrence = await Post(writer, $"/api/visits/{visit}/occurrences", new { adoptionId = adoption, number = 1 });
        var endpoint = $"/api/occurrences/{Id(occurrence)}";
        Assert.Equal(HttpStatusCode.NotFound, (await other.PostAsJsonAsync(endpoint + "/not-done", new { expectedRevision = Revision(occurrence), reason = "不在授權院所" })).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await writer.PostAsJsonAsync(endpoint + "/not-done", new { expectedRevision = Revision(occurrence), reason = " " })).StatusCode);
        var notDone = await Post(writer, endpoint + "/not-done", new { expectedRevision = Revision(occurrence), reason = "受試者當日未到院" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await writer.PostAsJsonAsync(endpoint + "/responses", new { data = new { weight = 65, height = 170 } })).StatusCode);
        var progress = (await Get(writer, $"/api/studies/{study}/progress")).AsArray().Single()!;
        Assert.Equal(1, progress["notDone"]!.GetValue<int>()); Assert.False(progress["missing"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.Conflict, (await writer.PostAsJsonAsync(endpoint + "/resume", new { expectedRevision = Revision(occurrence), reason = "補做訪視" })).StatusCode);
        await Post(writer, endpoint + "/resume", new { expectedRevision = Revision(notDone), reason = "已安排補做訪視" });
        await Post(writer, endpoint + "/responses", new { data = new { weight = 65, height = 170 } });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await writer.PostAsJsonAsync(endpoint + "/not-done", new { expectedRevision = Revision(notDone) + 1, reason = "不能隱藏既有填答" })).StatusCode);
        var audit = (await Get(reviewer, $"/api/studies/{study}/audit")).AsArray();
        Assert.Contains(audit, x => x!["action"]!.GetValue<string>() == "occurrence.not-done");
        Assert.Contains(audit, x => x!["action"]!.GetValue<string>() == "occurrence.resumed");
    }

    [Fact]
    public async Task Anonymous_and_unassigned_operator_cannot_access_research_content()
    {
        var (study, a, _) = await Study(); var (subject, _, _) = await Subject(study, a);
        using var anonymous = fixture.App.CreateClient(); Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/studies")).StatusCode);
        using var b = fixture.Client("dev-site-b");
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/subjects/{subject}/visits")).StatusCode);
        var list = (await Get(b, $"/api/studies/{study}/subjects")).AsArray(); Assert.Empty(list);
        using var operatorClient = fixture.Client();
        var users = (await Get(operatorClient, "/api/users")).AsArray();
        // The other study has no grant for this study's site personnel.
        var other = Id(await Post(operatorClient, "/api/studies", new { code = "OTHER-" + Guid.NewGuid().ToString("N"), name = "另一研究" }));
        Assert.Empty((await Get(b, $"/api/studies/{other}/subjects")).AsArray());
    }

    [Fact]
    public async Task Unconfirmed_basis_blocks_even_empty_research_draft_then_confirmation_allows_it()
    {
        var (study, a, _) = await Study(); var (_, visit, basis) = await Subject(study, a, false); var (_, adoption) = await Published(study);
        using var writer = fixture.Client("dev-site-a"); using var reviewer = fixture.Client("dev-reviewer");
        var blocked = await writer.PostAsJsonAsync($"/api/visits/{visit}/occurrences", new { adoptionId = adoption, number = 1 });
        Assert.Equal(HttpStatusCode.Conflict, blocked.StatusCode); Assert.Contains("COLLECTION_BASIS_REQUIRED", await blocked.Content.ReadAsStringAsync());
        await Post(reviewer, $"/api/collection-bases/{Id(basis)}/confirm", new { expectedRevision = Revision(basis), reason = "核對依據" });
        var occurrence = Id(await Post(writer, $"/api/visits/{visit}/occurrences", new { adoptionId = adoption, number = 1 }));
        await Post(writer, $"/api/occurrences/{occurrence}/responses", new { data = new { } });
    }

    [Fact]
    public async Task Full_response_lifecycle_recomputes_data_revalidates_and_preserves_revisions()
    {
        var (study, a, _) = await Study(); var (_, visit, _) = await Subject(study, a); var (_, adoption) = await Published(study);
        using var writer = fixture.Client("dev-site-a"); using var reviewer = fixture.Client("dev-reviewer");
        var occurrence = Id(await Post(writer, $"/api/visits/{visit}/occurrences", new { adoptionId = adoption, number = 1 }));
        var response = await Post(writer, $"/api/occurrences/{occurrence}/responses", new { data = new { weight = 65, height = 170, bmi = 999, symptom = false, detail = "隱藏值不可保留" } });
        var id = Id(response); Assert.InRange(response["data"]!["bmi"]!.GetValue<double>(), 22.49, 22.50); Assert.Null(response["data"]!["detail"]);
        response = await Post(writer, $"/api/responses/{id}/submit", new { expectedRevision = Revision(response), reason = "確認送出" });
        response = await Post(reviewer, $"/api/responses/{id}/review", new { expectedRevision = Revision(response), reason = "核對資料" });
        Assert.Equal("reviewed", response["state"]!.GetValue<string>());
        var corrected = await writer.PutAsJsonAsync($"/api/responses/{id}", new { expectedRevision = Revision(response), data = new { weight = 66, height = 170 }, reason = "修正誤植" });
        corrected.EnsureSuccessStatusCode(); response = (await corrected.Content.ReadFromJsonAsync<JsonNode>())!;
        Assert.Equal("submitted", response["state"]!.GetValue<string>()); Assert.Null(response["reviewedBy"]);
        var stale = await writer.PutAsJsonAsync($"/api/responses/{id}", new { expectedRevision = 1, data = new { weight = 67, height = 170 }, reason = "舊版本不得覆寫" }); Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        response = await Post(reviewer, $"/api/responses/{id}/review", new { expectedRevision = Revision(response), reason = "重新審閱" });
        response = await Post(reviewer, $"/api/responses/{id}/lock", new { expectedRevision = Revision(response), reason = "鎖定" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await writer.PutAsJsonAsync($"/api/responses/{id}", new { expectedRevision = Revision(response), data = new { weight = 67, height = 170 }, reason = "不得更改鎖定資料" })).StatusCode);
        var revisions = (await Get(reviewer, $"/api/responses/{id}/revisions")).AsArray(); Assert.Equal(6, revisions.Count);
        await using var scope = fixture.App.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<PlatformDb>();
        Assert.Equal(66, JsonNode.Parse((await db.Responses.AsNoTracking().SingleAsync(x => x.Id == id)).DataJson)!["weight"]!.GetValue<int>());
        Assert.True(await db.Outbox.AnyAsync(x => x.StudyId == study && x.Type == "response.lock"));
    }

    [Fact]
    public async Task Independent_publishing_is_required_and_published_version_is_immutable()
    {
        var (study, _, _) = await Study(); using var client = fixture.Client();
        var template = Id(await Post(client, $"/api/studies/{study}/templates", new { name = "自審測試", kind = "ecrf" }));
        var version = await Post(client, $"/api/templates/{template}/versions", new { version = "1.0.0", contract = Contract(), sourceYaml = "" });
        version = await Post(client, $"/api/form-versions/{Id(version)}/submit", new { expectedRevision = Revision(version), reason = "送審" });
        var self = await client.PostAsJsonAsync($"/api/form-versions/{Id(version)}/publish", new { expectedRevision = Revision(version), reason = "自審應拒絕" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, self.StatusCode); Assert.Contains("SELF_APPROVAL", await self.Content.ReadAsStringAsync());
        using var reviewer = fixture.Client("dev-reviewer");
        version = await Post(reviewer, $"/api/form-versions/{Id(version)}/publish", new { expectedRevision = Revision(version), reason = "獨立核准" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await client.PutAsJsonAsync($"/api/form-versions/{Id(version)}", new { expectedRevision = Revision(version), contract = Contract(), sourceYaml = "", reason = "不得覆寫" })).StatusCode);
    }

    [Fact]
    public async Task Required_mapping_blocks_publication_but_optional_unresolved_does_not()
    {
        var (study, _, _) = await Study(); using var client = fixture.Client(); using var designer = fixture.Client("dev-designer");
        var policy = await client.PutAsJsonAsync($"/api/studies/{study}/policy", new { expectedRevision = 1, contextAuthority = "platform", icfCustody = "site", requiredMappings = new[] { "/weight" }, active = true, reason = "研究要求體重標準化" }); policy.EnsureSuccessStatusCode();
        var template = Id(await Post(designer, $"/api/studies/{study}/templates", new { name = "必要對應", kind = "ecrf" }));
        var version = await Post(designer, $"/api/templates/{template}/versions", new { version = "1.0.0", contract = Contract(), sourceYaml = "" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await designer.PostAsJsonAsync($"/api/form-versions/{Id(version)}/submit", new { expectedRevision = Revision(version), reason = "必要對應未完成" })).StatusCode);
    }

    [Fact]
    public async Task Withdrawn_basis_blocks_existing_response_modifications_and_new_occurrences()
    {
        var (study, a, _) = await Study(); var (_, visit, basis) = await Subject(study, a); var (_, adoption) = await Published(study);
        using var writer = fixture.Client("dev-site-a"); using var reviewer = fixture.Client("dev-reviewer");
        var occurrence = Id(await Post(writer, $"/api/visits/{visit}/occurrences", new { adoptionId = adoption, number = 1 }));
        var response = await Post(writer, $"/api/occurrences/{occurrence}/responses", new { data = new { weight = 60, height = 170 } });
        await Post(reviewer, $"/api/collection-bases/{Id(basis)}/withdraw", new { expectedRevision = Revision(basis), reason = "受試者撤回後續收集" });
        Assert.Equal(HttpStatusCode.Conflict, (await writer.PutAsJsonAsync($"/api/responses/{Id(response)}", new { expectedRevision = Revision(response), data = new { weight = 61, height = 170 }, reason = "應拒絕" })).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await writer.PostAsJsonAsync($"/api/visits/{visit}/occurrences", new { adoptionId = adoption, number = 2 })).StatusCode);
    }

    [Fact]
    public async Task Query_requires_answer_and_close_before_independent_review()
    {
        var (study, a, _) = await Study(); var (_, visit, _) = await Subject(study, a); var (_, adoption) = await Published(study);
        using var writer = fixture.Client("dev-site-a"); using var reviewer = fixture.Client("dev-reviewer");
        var occurrence = Id(await Post(writer, $"/api/visits/{visit}/occurrences", new { adoptionId = adoption, number = 1 }));
        var response = await Post(writer, $"/api/occurrences/{occurrence}/responses", new { data = new { weight = 65, height = 170 } });
        response = await Post(writer, $"/api/responses/{Id(response)}/submit", new { expectedRevision = Revision(response), reason = "送出" });
        var query = await Post(reviewer, $"/api/responses/{Id(response)}/queries", new { path = "/weight", question = "請核對原始體重" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await reviewer.PostAsJsonAsync($"/api/queries/{Id(query)}/close", new { expectedRevision = Revision(query), answer = "" })).StatusCode);
        query = await Post(writer, $"/api/queries/{Id(query)}/answer", new { expectedRevision = Revision(query), answer = "已核對原始紀錄無誤" });
        await Post(reviewer, $"/api/queries/{Id(query)}/close", new { expectedRevision = Revision(query), answer = "" });
        response = await Get(writer, $"/api/responses/{Id(response)}");
        response = await Post(writer, $"/api/responses/{Id(response)}/submit", new { expectedRevision = Revision(response), reason = "疑問已回覆" });
        response = await Post(reviewer, $"/api/responses/{Id(response)}/review", new { expectedRevision = Revision(response), reason = "完成審閱" });
        Assert.Equal("reviewed", response["state"]!.GetValue<string>());
    }

    [Fact]
    public async Task Export_pins_revisions_restricts_requester_and_rechecks_withdrawal()
    {
        var (study, a, _) = await Study(); var (_, visit, basis) = await Subject(study, a); var (_, adoption) = await Published(study);
        using var writer = fixture.Client("dev-site-a"); using var reviewer = fixture.Client("dev-reviewer");
        var occurrence = Id(await Post(writer, $"/api/visits/{visit}/occurrences", new { adoptionId = adoption, number = 1 }));
        var response = await Post(writer, $"/api/occurrences/{occurrence}/responses", new { data = new { weight = 65, height = 170 } });
        response = await Post(writer, $"/api/responses/{Id(response)}/submit", new { expectedRevision = Revision(response), reason = "送出" });
        var export = await Post(reviewer, $"/api/studies/{study}/exports", new { purpose = "research", reason = "研究核對" });
        Assert.Equal(1, export["count"]!.GetValue<int>());
        var content = await Get(reviewer, $"/api/exports/{Id(export)}");
        Assert.Equal(65, content["records"]![0]!["data"]!["weight"]!.GetValue<int>());
        Assert.Equal(HttpStatusCode.NotFound, (await writer.GetAsync($"/api/exports/{Id(export)}")).StatusCode);
        var correction = await writer.PutAsJsonAsync($"/api/responses/{Id(response)}", new { expectedRevision = Revision(response), data = new { weight = 66, height = 170 }, reason = "更正" }); correction.EnsureSuccessStatusCode();
        var pinned = await Get(reviewer, $"/api/exports/{Id(export)}"); Assert.Equal(65, pinned["records"]![0]!["data"]!["weight"]!.GetValue<int>());
        await Post(reviewer, $"/api/collection-bases/{Id(basis)}/withdraw", new { expectedRevision = Revision(basis), reason = "撤回用途" });
        Assert.Equal(HttpStatusCode.Conflict, (await reviewer.GetAsync($"/api/exports/{Id(export)}")).StatusCode);
    }

    [Fact]
    public async Task Integration_writes_share_validation_require_source_and_deduplicate_retries()
    {
        var (study, a, _) = await Study(); var (_, visit, _) = await Subject(study, a); var (_, adoption) = await Published(study);
        using var admin = fixture.Client(); using var writer = fixture.Client("dev-site-a"); using var integration = fixture.Client("dev-ctms");
        var user = (await Get(admin, "/api/users")).AsArray().Single(x => x!["name"]!.GetValue<string>() == "CTMS 合成整合程式")!;
        var grant = await Post(admin, $"/api/studies/{study}/grants", new { userId = Id(user), siteId = a, crossSite = false, permissions = Permission.Read | Permission.Collect | Permission.Integrate, reason = "限定甲院整合" });
        var occurrence = Id(await Post(writer, $"/api/visits/{visit}/occurrences", new { adoptionId = adoption, number = 1 }));
        integration.DefaultRequestHeaders.Add("Idempotency-Key", "create-" + Guid.NewGuid().ToString("N"));
        var input = new { occurrenceId = occurrence, externalRecordId = "external-001", data = new { weight = 65, height = 170, bmi = 999 } };
        var response = await Post(integration, "/api/integrations/responses", input);
        var replay = await Post(integration, "/api/integrations/responses", input); Assert.Equal(Id(response), Id(replay));
        Assert.Equal(1, Revision(replay)); Assert.InRange(response["data"]!["bmi"]!.GetValue<double>(), 22.49, 22.50);
        Assert.Equal(HttpStatusCode.Conflict, (await integration.PostAsJsonAsync("/api/integrations/responses", new { occurrenceId = occurrence, externalRecordId = "different", data = new { weight = 66, height = 170 } })).StatusCode);
        var bypass = await integration.PutAsJsonAsync($"/api/responses/{Id(response)}", new { expectedRevision = 1, data = new { weight = 66, height = 170 }, reason = "不得繞過來源端點" });
        Assert.Equal(HttpStatusCode.UnprocessableEntity, bypass.StatusCode);
        await using var scope = fixture.App.Services.CreateAsyncScope(); var db = scope.ServiceProvider.GetRequiredService<PlatformDb>();
        var revision = await db.Revisions.AsNoTracking().SingleAsync(x => x.ResponseId == Id(response)); Assert.Equal("ctms-demo", revision.Source); Assert.Equal("external-001", revision.ExternalRecordId);
        await Post(admin, $"/api/studies/{study}/grants/{Id(grant)}/revoke", new { reason = "撤銷整合權限" });
        Assert.Equal(HttpStatusCode.NotFound, (await integration.PostAsJsonAsync("/api/integrations/responses", input)).StatusCode);
    }

    [Fact]
    public async Task CTMS_context_has_explicit_external_identity_and_rejects_local_creation()
    {
        var (study, a, _) = await Study(); using var admin = fixture.Client(); using var integration = fixture.Client("dev-ctms");
        var user = (await Get(admin, "/api/users")).AsArray().Single(x => x!["name"]!.GetValue<string>() == "CTMS 合成整合程式")!;
        await Post(admin, $"/api/studies/{study}/grants", new { userId = Id(user), siteId = a, crossSite = false, permissions = Permission.Read | Permission.Collect | Permission.Integrate, reason = "CTMS 脈絡維護" });
        var policy = await admin.PutAsJsonAsync($"/api/studies/{study}/policy", new { expectedRevision = 1, contextAuthority = "ctms", icfCustody = "site", requiredMappings = Array.Empty<string>(), active = true, reason = "指定 CTMS 維護" }); policy.EnsureSuccessStatusCode();
        integration.DefaultRequestHeaders.Add("Idempotency-Key", "context-" + Guid.NewGuid().ToString("N"));
        var subject = await Post(integration, $"/api/integrations/studies/{study}/subjects", new { siteId = a, externalId = "CTMS-SUB-001", code = "RESEARCH-001" });
        var again = await Post(integration, $"/api/integrations/studies/{study}/subjects", new { siteId = a, externalId = "CTMS-SUB-001", code = "RESEARCH-001" });
        Assert.Equal(Id(subject), Id(again));
        integration.DefaultRequestHeaders.Remove("Idempotency-Key");
        integration.DefaultRequestHeaders.Add("Idempotency-Key", "visit-" + Guid.NewGuid().ToString("N"));
        var visitInput = new { subjectId = Id(subject), externalId = "CTMS-VISIT-001", name = "外部訪視", date = "2026-01-01", unscheduled = true };
        var visit = await Post(integration, "/api/integrations/visits", visitInput);
        Assert.Equal(Id(visit), Id(await Post(integration, "/api/integrations/visits", visitInput)));
        using var local = fixture.Client("dev-site-a");
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await local.PostAsJsonAsync($"/api/subjects/{Id(subject)}/visits", new { name = "本地訪視", date = "2026-01-01", unscheduled = true })).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await local.PostAsJsonAsync($"/api/studies/{study}/subjects", new { siteId = a, code = "LOCAL-001" })).StatusCode);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, (await admin.PostAsJsonAsync($"/api/studies/{study}/grants", new { userId = Id(user), siteId = (Guid?)null, crossSite = true, permissions = Permission.Publish, reason = "不得讓整合程式自動核准" })).StatusCode);
    }
}
