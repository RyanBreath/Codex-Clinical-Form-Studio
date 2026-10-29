using System.Text.Json.Nodes;
using FormPlatform.Api.Core;
using FormPlatform.Api.Modules;

namespace FormPlatform.IntegrationTests;
public sealed class ContractEngineTests
{
    private readonly ContractEngine engine = new();
    private static JsonObject Contract() => JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", "platform-vitals.json")))!.AsObject();
    [Fact]
    public void Shared_contract_recomputes_and_excludes_hidden_values()
    {
        var contract = engine.Contract(Contract().ToJsonString());
        var result = engine.Evaluate(contract, JsonNode.Parse("""{"weight":65,"height":170,"bmi":999,"symptom":false,"detail":"hidden"}""")!.AsObject(), true);
        Assert.Empty(result.Issues); Assert.Null(result.Data["detail"]); Assert.InRange(result.Data["bmi"]!.GetValue<double>(), 22.49, 22.50);
    }
    [Fact]
    public void Conditional_required_invalid_ranges_and_unknown_data_are_rejected()
    {
        var contract = engine.Contract(Contract().ToJsonString());
        Assert.Contains(engine.Evaluate(contract, JsonNode.Parse("""{"weight":65,"height":170,"symptom":true}""")!.AsObject(), true).Issues, x => x.Path == "/detail");
        Assert.NotEmpty(engine.Evaluate(contract, JsonNode.Parse("""{"weight":999,"height":170}""")!.AsObject(), true).Issues);
        Assert.Contains(engine.Evaluate(contract, JsonNode.Parse("""{"weight":65,"height":170,"unexpected":"must not disappear"}""")!.AsObject(), true).Issues, x => x.Code == "additionalProperties");
    }
    [Fact]
    public void Remote_schema_references_and_cyclic_computations_fail_before_execution()
    {
        var contract = Contract(); contract["properties"]!["weight"]!["$ref"] = "https://invalid.test/untrusted";
        Assert.Throws<PlatformError>(() => engine.Contract(contract.ToJsonString()));
        contract = Contract(); contract["x-airwayai"]!["computed"]!["/bmi"] = JsonNode.Parse("""{"op":"path","path":"/bmi"}""");
        Assert.Throws<PlatformError>(() => engine.Contract(contract.ToJsonString()));
    }
    [Fact]
    public void Old_contract_does_not_gain_unresolved_mapping_support()
    {
        var contract = Contract(); contract["x-airwayai"]!["contractVersion"] = "1.1.0";
        Assert.Throws<PlatformError>(() => engine.Contract(contract.ToJsonString()));
    }
    [Fact]
    public void Mismatched_layout_and_non_numeric_computed_sources_fail_closed()
    {
        var contract = Contract(); contract["x-airwayai"]!["layout"]![0]!["items"]!.AsArray().RemoveAt(0);
        Assert.Throws<PlatformError>(() => engine.Contract(contract.ToJsonString()));
        contract = Contract(); contract["x-airwayai"]!["computed"]!["/bmi"] = JsonNode.Parse("""{"op":"path","path":"/symptom"}""");
        Assert.Throws<PlatformError>(() => engine.Contract(contract.ToJsonString()));
    }
    [Fact]
    public void Hash_is_independent_of_property_order_and_whitespace()
    {
        Assert.Equal(ContractEngine.Hash("{\"a\":1,\"b\":2}"), ContractEngine.Hash("{ \"b\": 2, \"a\": 1 }"));
    }
}
