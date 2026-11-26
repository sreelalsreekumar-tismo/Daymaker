namespace Daymaker.Api.Services;

public static class SqlText
{
    public const string Escape = "\\";

    /// <summary>Builds a LIKE pattern matching the text anywhere, escaping wildcards. SQLite LIKE is case-insensitive for ASCII.</summary>
    public static string Contains(string q) =>
        "%" + q.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
}
