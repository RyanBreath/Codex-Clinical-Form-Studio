namespace FormPlatform.Api.Core;

public sealed class PlatformError(int status, string code, string message, object? details = null)
    : Exception(message)
{
    public int Status { get; } = status;
    public string Code { get; } = code;
    public object? Details { get; } = details;
    public static PlatformError Invalid(string code, string message, object? details = null) => new(422, code, message, details);
    public static PlatformError Missing() => new(404, "NOT_FOUND", "找不到紀錄或沒有存取權限。");
    public static void Check(bool condition, string code, string message)
    {
        if (!condition) throw Invalid(code, message);
    }
    public static void Revision(long expected, long actual)
    {
        if (expected != actual) throw new PlatformError(409, "REVISION_CONFLICT", "紀錄已被修改，請重新載入。", new { revision = actual });
    }
    public static string Text(string? value, string name, int max = 250)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Trim().Length > max)
            throw Invalid("INVALID_TEXT", $"{name}必須填寫且不可超過 {max} 字。");
        return value.Trim();
    }
}
