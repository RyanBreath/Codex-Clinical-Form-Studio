using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using FormPlatform.Api.Core;
using Json.Schema;

namespace FormPlatform.Api.Modules;

public sealed record RuleIssue(string Path, string Code, string Message);

public sealed class ContractEngine
{
    private static readonly JsonSchema MetaSchema = LoadMetaSchema();
    private static JsonSchema LoadMetaSchema()
    {
        using var stream = typeof(ContractEngine).Assembly.GetManifestResourceStream("FormPlatform.ContractMetaSchema.json")!;
        using var reader = new StreamReader(stream);
        return JsonSchema.FromText(reader.ReadToEnd());
    }
    public static string Hash(string json) => Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(Canonical(JsonNode.Parse(json)))));
    private static string Canonical(JsonNode? n) => n switch
    {
        JsonObject o => "{" + string.Join(',', o.OrderBy(x => x.Key, StringComparer.Ordinal).Select(x => System.Text.Json.JsonSerializer.Serialize(x.Key) + ":" + Canonical(x.Value))) + "}",
        JsonArray a => "[" + string.Join(',', a.Select(Canonical)) + "]", _ => n?.ToJsonString() ?? "null"
    };
    private static readonly HashSet<string> SchemaKeywords = ["$schema", "$id", "$comment", "title", "description", "type", "additionalProperties", "properties", "required", "items", "enum", "const", "format", "pattern", "minLength", "maxLength", "minimum", "maximum", "uniqueItems", "readOnly", "x-airwayai"];

    public JsonObject Contract(string json)
    {
        var contract = JsonNode.Parse(json) as JsonObject ?? throw PlatformError.Invalid("CONTRACT_INVALID", "表單合約必須是物件。");
        var envelope = MetaSchema.Evaluate(contract, new EvaluationOptions { OutputFormat = OutputFormat.List });
        if (!envelope.IsValid)
        {
            var errors = new List<RuleIssue>(); CollectErrors(envelope, errors);
            throw PlatformError.Invalid("CONTRACT_INVALID", "表單合約結構不符合共用規格。", errors);
        }
        PlatformError.Check(contract["type"]?.GetValue<string>() == "object" && contract["additionalProperties"]?.GetValue<bool>() == false,
            "CONTRACT_INVALID", "表單根層必須是封閉物件。");
        var extension = contract["x-airwayai"] as JsonObject ?? throw PlatformError.Invalid("CONTRACT_INVALID", "缺少表單執行定義。");
        PlatformError.Check(extension["contractVersion"]?.GetValue<string>() is "1.0.0" or "1.1.0" or "1.2.0", "CONTRACT_VERSION", "不支援的表單契約版本。");
        var fields = extension["fields"] as JsonObject ?? throw PlatformError.Invalid("FIELDS_REQUIRED", "缺少欄位定義。");
        var contractVersion = extension["contractVersion"]!.GetValue<string>();
        PlatformError.Check(fields.Count is > 0 and <= 500, "FIELD_COUNT", "欄位數必須介於 1 至 500。");
        ValidateSchema(contract, 0);
        foreach (var (path, node) in fields)
        {
            PlatformError.Check(path.StartsWith('/') && node is JsonObject && Property(contract, path) != null, "FIELD_PATH", $"欄位路徑無效：{path}");
            var config = node!.AsObject();
            PlatformError.Check(contractVersion == "1.0.0" || config["coding"] != null, "MAPPING_STATUS", "此契約版本須明確記錄欄位對應狀態。");
            PlatformError.Check(config["widget"]?.GetValue<string>() is "text" or "textarea" or "integer" or "number" or "date" or "radio" or "select" or "checkbox_group" or "boolean" or "computed" or "coordinate_3d", "WIDGET_INVALID", $"欄位元件無效：{path}");
            foreach (var key in new[] { "visibleWhen", "enabledWhen", "requiredWhen" }) if (config[key] != null) ValidatePredicate(config[key]!, fields, 0);
            if (config["visibleWhen"] != null || config["enabledWhen"] != null)
                PlatformError.Check(!StaticRequired(contract, path), "CONDITIONAL_STATIC_REQUIRED", "條件顯示欄位須使用 requiredWhen，不能列為靜態必填。");
            if (config["coding"] is JsonObject coding)
            {
                var status = coding["status"]?.GetValue<string>();
                PlatformError.Check(status is "matched" or "not-applicable" or "unresolved", "MAPPING_STATUS", "對應狀態無效。");
                PlatformError.Check(status != "unresolved" || contractVersion == "1.2.0", "MAPPING_VERSION", "舊版契約不支援未完成對應。");
                if (status == "not-applicable") PlatformError.Check(coding["rationale"] is JsonObject rationale && rationale.Any(x => !string.IsNullOrWhiteSpace(x.Value?.GetValue<string>())), "MAPPING_RATIONALE", "不適用對應須記錄理由。");
                if (status == "matched") PlatformError.Check(coding["standard"]?.GetValue<string>() == "CDISC" && coding["model"] != null && coding["version"] != null && coding["source"] != null && (coding["variable"] != null || coding["codelist"] != null), "MAPPING_INCOMPLETE", "已確認對應缺少標準、版本、來源或變數／碼表。");
            }
        }
        var layoutPaths = new List<string>();
        foreach (var section in extension["layout"]!.AsArray())
            foreach (var item in section!["items"]!.AsArray())
                if (item!["type"]!.GetValue<string>() == "group") layoutPaths.AddRange(item["items"]!.AsArray().Select(x => x!["path"]!.GetValue<string>()));
                else layoutPaths.Add(item["path"]!.GetValue<string>());
        PlatformError.Check(layoutPaths.Distinct().Count() == layoutPaths.Count && layoutPaths.ToHashSet().SetEquals(fields.Select(x => x.Key)), "LAYOUT_FIELDS", "版面須完整且不重複地列出所有欄位。");
        var computations = extension["computed"] as JsonObject ?? throw PlatformError.Invalid("COMPUTED_REQUIRED", "缺少 computed 定義。");
        foreach (var (path, expression) in computations)
        {
            PlatformError.Check(fields[path]?["widget"]?.GetValue<string>() == "computed" && Property(contract, path)?["readOnly"]?.GetValue<bool>() == true, "COMPUTED_TARGET", "衍生欄位須標為唯讀計算欄位。");
            ValidateExpression(expression!, fields, 0);
            foreach (var source in ExpressionPaths(expression!)) PlatformError.Check(Property(contract, source)?["type"]?.GetValue<string>() is "number" or "integer", "COMPUTED_SOURCE", "計算來源必須是數值欄位。");
            ResolveCalculation(path, computations, new JsonObject(), new HashSet<string>(), new HashSet<string>());
        }
        _ = JsonSchema.FromText(contract.ToJsonString());
        return contract;
    }

    private static IEnumerable<string> ExpressionPaths(JsonNode expression)
    {
        if (expression["op"]?.GetValue<string>() == "path") yield return expression["path"]!.GetValue<string>();
        if (expression["args"] is JsonArray args) foreach (var arg in args) foreach (var path in ExpressionPaths(arg!)) yield return path;
    }

    private static void ValidateSchema(JsonObject schema, int depth)
    {
        PlatformError.Check(depth <= 12, "SCHEMA_DEPTH", "資料結構過深。");
        foreach (var (key, _) in schema) PlatformError.Check(SchemaKeywords.Contains(key), "UNSUPPORTED_SCHEMA_KEYWORD", $"不支援的結構關鍵字：{key}");
        if (schema["pattern"] is JsonValue pattern) PlatformError.Check(pattern.GetValue<string>().Length <= 250, "PATTERN_LENGTH", "格式規則過長。");
        if (schema["properties"] is JsonObject properties) foreach (var (_, child) in properties) ValidateSchema(child!.AsObject(), depth + 1);
        if (schema["items"] is JsonObject items) ValidateSchema(items, depth + 1);
        if (schema["format"] != null) PlatformError.Check(schema["format"]!.GetValue<string>() == "date", "FORMAT_UNSUPPORTED", "目前只支援 date 格式。");
    }

    public List<RuleIssue> MappingIssues(JsonObject contract, IEnumerable<string> required)
    {
        var fields = contract["x-airwayai"]!["fields"]!.AsObject(); var issues = new List<RuleIssue>();
        foreach (var path in required)
        {
            var coding = fields[path]?["coding"];
            if (coding?["status"]?.GetValue<string>() != "matched") issues.Add(new(path, "MAPPING_REQUIRED", "研究要求此欄位完成人工確認對應。"));
        }
        return issues;
    }

    public List<RuleIssue> PublicationIssues(JsonObject contract, IEnumerable<string> required)
    {
        var issues = MappingIssues(contract, required);
        if (contract["x-airwayai"]?["reviewIssues"] is JsonArray review)
            foreach (var item in review)
                if (item?["severity"]?.GetValue<string>() == "blocking" && string.IsNullOrWhiteSpace(item["resolution"]?.GetValue<string>()))
                    issues.Add(new("/x-airwayai/reviewIssues/" + item["id"]!.GetValue<string>(), "SOURCE_REVIEW_REQUIRED", item["question"]!.GetValue<string>()));
        return issues;
    }

    public (JsonObject Data, List<RuleIssue> Issues) Evaluate(JsonObject contract, JsonObject input, bool complete)
    {
        var extension = contract["x-airwayai"]!.AsObject(); var fields = extension["fields"]!.AsObject();
        var computed = extension["computed"]!.AsObject(); var display = input.DeepClone().AsObject();
        foreach (var (path, _) in computed) ResolveCalculation(path, computed, display, [], []);
        var data = new JsonObject(); var issues = new List<RuleIssue>();
        CheckUnknown(contract, input, "", issues);
        foreach (var (path, config) in fields)
        {
            var visible = config!["visibleWhen"] is null || Predicate(config["visibleWhen"]!, display);
            var enabled = visible && (config["enabledWhen"] is null || Predicate(config["enabledWhen"]!, display));
            var active = visible && (enabled || config["widget"]?.GetValue<string>() == "computed");
            if (!active) continue;
            var value = Get(display, path);
            if (value != null) Set(data, path, value.DeepClone());
            var required = StaticRequired(contract, path) || config["requiredWhen"] != null && Predicate(config["requiredWhen"]!, display);
            if (complete && required && Empty(value)) issues.Add(new(path, "required", "必填欄位尚未填寫。"));
        }
        foreach (var (path, _) in computed) ResolveCalculation(path, computed, data, [], []);
        var schema = contract.DeepClone().AsObject(); schema.Remove("x-airwayai");
        if (!complete) RemoveRequired(schema);
        var result = JsonSchema.FromText(schema.ToJsonString()).Evaluate(data, new EvaluationOptions { OutputFormat = OutputFormat.List, RequireFormatValidation = true });
        CollectErrors(result, issues);
        return (data, issues.Distinct().ToList());
    }
    private static void CollectErrors(EvaluationResults result, List<RuleIssue> issues)
    {
        if (result.Errors != null) foreach (var (key, message) in result.Errors) issues.Add(new(result.InstanceLocation.ToString(), key, message));
        if (result.Details != null) foreach (var child in result.Details) CollectErrors(child, issues);
    }
    private static void CheckUnknown(JsonObject schema, JsonObject data, string prefix, List<RuleIssue> issues)
    {
        var properties = schema["properties"] as JsonObject;
        foreach (var (key, value) in data)
        {
            var path = prefix + "/" + key.Replace("~", "~0").Replace("/", "~1");
            if (properties?[key] == null) issues.Add(new(path, "additionalProperties", "未宣告的欄位。"));
            else if (value is JsonObject nested && properties[key] is JsonObject s) CheckUnknown(s, nested, path, issues);
        }
    }
    private static void RemoveRequired(JsonObject schema)
    {
        schema.Remove("required");
        if (schema["properties"] is JsonObject p) foreach (var (_, c) in p) if (c is JsonObject child) RemoveRequired(child);
        if (schema["items"] is JsonObject items) RemoveRequired(items);
    }
    private static bool Empty(JsonNode? value) => value == null || value is JsonArray { Count: 0 } || value is JsonValue v && v.TryGetValue<string>(out var s) && s == "";
    private static string[] Tokens(string path) => path.Split('/').Skip(1).Select(x => x.Replace("~1", "/").Replace("~0", "~")).ToArray();
    private static JsonNode? Get(JsonNode? data, string path) { foreach (var token in Tokens(path)) { if (data is not JsonObject o) return null; data = o[token]; } return data; }
    private static void Set(JsonObject data, string path, JsonNode? value)
    {
        var tokens = Tokens(path); var current = data;
        for (var i = 0; i < tokens.Length - 1; i++) { current[tokens[i]] ??= new JsonObject(); current = current[tokens[i]]!.AsObject(); }
        if (value == null) current.Remove(tokens[^1]); else current[tokens[^1]] = value;
    }
    private static JsonObject? Property(JsonObject schema, string path)
    {
        JsonObject? current = schema; foreach (var token in Tokens(path)) current = current?["properties"]?[token] as JsonObject; return current;
    }
    private static bool StaticRequired(JsonObject schema, string path)
    {
        JsonObject? current = schema;
        foreach (var token in Tokens(path)) { if (current?["required"] is not JsonArray a || !a.Any(x => x?.GetValue<string>() == token)) return false; current = current["properties"]?[token] as JsonObject; }
        return true;
    }
    private static void ValidatePredicate(JsonNode p, JsonObject fields, int depth)
    {
        PlatformError.Check(depth < 20 && p is JsonObject, "PREDICATE_INVALID", "條件結構無效或過深。");
        foreach (var key in new[] { "all", "any" }) if (p[key] is JsonArray items) { PlatformError.Check(items.Count is > 0 and <= 100, "PREDICATE_INVALID", "條件集合無效。"); foreach (var item in items) ValidatePredicate(item!, fields, depth + 1); return; }
        if (p["not"] != null) { ValidatePredicate(p["not"]!, fields, depth + 1); return; }
        PlatformError.Check(p["path"] is JsonValue path && fields[path.GetValue<string>()] != null && fields[path.GetValue<string>()]?["widget"]?.GetValue<string>() != "computed", "PREDICATE_PATH", "條件必須參照存在且非計算欄位。");
        PlatformError.Check(p["op"]?.GetValue<string>() is "exists" or "eq" or "neq" or "lt" or "lte" or "gt" or "gte" or "in" or "contains", "PREDICATE_OPERATOR", "不支援的條件運算子。");
    }
    public static bool Predicate(JsonNode p, JsonObject data)
    {
        if (p["all"] is JsonArray all) return all.All(x => Predicate(x!, data));
        if (p["any"] is JsonArray any) return any.Any(x => Predicate(x!, data));
        if (p["not"] is JsonNode not) return !Predicate(not, data);
        var current = Get(data, p["path"]!.GetValue<string>()); var op = p["op"]!.GetValue<string>(); var value = p["value"];
        if (op == "exists") return current != null; if (current == null) return false;
        return op switch
        {
            "eq" => Equal(current, value), "neq" => !Equal(current, value),
            "in" => value is JsonArray values && values.Any(x => Equal(x, current)),
            "contains" => current is JsonArray a ? a.Any(x => Equal(x, value)) : current is JsonValue s && s.TryGetValue<string>(out var text) && value is JsonValue v && v.TryGetValue<string>(out var sub) && text.Contains(sub, StringComparison.Ordinal),
            _ => Number(current) is double left && Number(value) is double right && op switch { "lt" => left < right, "lte" => left <= right, "gt" => left > right, "gte" => left >= right, _ => false }
        };
    }
    private static bool Equal(JsonNode? a, JsonNode? b) => Number(a) is double left && Number(b) is double right ? left == right : JsonNode.DeepEquals(a, b);
    private static double? Number(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var number) && double.IsFinite(number) ? number : null;
    private static void ValidateExpression(JsonNode e, JsonObject fields, int depth)
    {
        PlatformError.Check(depth < 20, "EXPRESSION_DEPTH", "計算結構過深。"); var op = e["op"]?.GetValue<string>();
        if (op == "value") { PlatformError.Check(Number(e["value"]) != null, "EXPRESSION_VALUE", "計算常數須為有限數值。"); return; }
        if (op == "path") { PlatformError.Check(e["path"] is JsonValue v && fields[v.GetValue<string>()] != null, "EXPRESSION_PATH", "計算來源不存在。"); return; }
        PlatformError.Check(op is "add" or "subtract" or "multiply" or "divide" && e["args"] is JsonArray { Count: >= 2 and <= 100 }, "EXPRESSION_OPERATOR", "不支援的計算。");
        foreach (var arg in e["args"]!.AsArray()) ValidateExpression(arg!, fields, depth + 1);
    }
    private static void ResolveCalculation(string path, JsonObject calculations, JsonObject data, HashSet<string> resolving, HashSet<string> resolved)
    {
        if (resolved.Contains(path)) return;
        PlatformError.Check(resolving.Add(path), "COMPUTED_CYCLE", "計算欄位存在循環依賴。");
        double? Eval(JsonNode expression)
        {
            var op = expression["op"]!.GetValue<string>();
            if (op == "value") return Number(expression["value"]);
            if (op == "path") { var source = expression["path"]!.GetValue<string>(); if (calculations[source] != null) ResolveCalculation(source, calculations, data, resolving, resolved); return Number(Get(data, source)); }
            var values = expression["args"]!.AsArray().Select(x => Eval(x!)).ToArray();
            if (values.Any(x => x == null)) return null; var total = values[0]!.Value;
            foreach (var item in values.Skip(1)) { if (op == "divide" && item == 0) return null; total = op switch { "add" => total + item!.Value, "subtract" => total - item!.Value, "multiply" => total * item!.Value, "divide" => total / item!.Value, _ => double.NaN }; }
            return double.IsFinite(total) ? total : null;
        }
        Set(data, path, Eval(calculations[path]!) is double result ? JsonValue.Create(result) : null);
        resolving.Remove(path); resolved.Add(path);
    }
}
