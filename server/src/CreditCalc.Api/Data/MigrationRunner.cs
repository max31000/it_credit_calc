using System.Reflection;
using Dapper;

namespace CreditCalc.Api.Data;

/// <summary>
/// Прогоняет embedded SQL-миграции (<c>Data/Migrations/*.sql</c>) на старте приложения.
/// Порт из bonds/Bonds.Infrastructure/MigrationRunner.cs без изменений алгоритма.
/// </summary>
public class MigrationRunner
{
    private readonly string _connectionString;
    private readonly ILogger<MigrationRunner> _logger;

    public MigrationRunner(string connectionString, ILogger<MigrationRunner> logger)
    {
        _connectionString = connectionString;
        _logger = logger;
    }

    public async Task RunAsync()
    {
        await using var conn = new MySqlConnector.MySqlConnection(_connectionString);
        await conn.OpenAsync();

        // Таблица учёта применённых миграций
        await conn.ExecuteAsync(@"
            CREATE TABLE IF NOT EXISTS _migrations (
                Id          INT           NOT NULL AUTO_INCREMENT,
                FileName    VARCHAR(255)  NOT NULL,
                AppliedAt   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (Id),
                UNIQUE KEY uq_migrations_filename (FileName)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

        var applied = (await conn.QueryAsync<string>("SELECT FileName FROM _migrations"))
            .ToHashSet();

        // Файлы миграций из EmbeddedResource (CreditCalc.Api/Data/Migrations/*.sql)
        var assembly = Assembly.GetExecutingAssembly();
        var migrationFiles = assembly.GetManifestResourceNames()
            .Where(n => n.Contains(".Migrations.") && n.EndsWith(".sql"))
            .OrderBy(n => n)
            .ToList();

        foreach (var resourceName in migrationFiles)
        {
            // Имя ресурса вида CreditCalc.Api.Data.Migrations.001_init.sql
            var parts = resourceName.Split('.');
            var sqlFileName = string.Join(".", parts.TakeLast(2)); // "001_init.sql"

            if (applied.Contains(sqlFileName))
            {
                _logger.LogDebug("Migration {FileName} already applied, skipping", sqlFileName);
                continue;
            }

            _logger.LogInformation("Applying migration: {FileName}", sqlFileName);

            using var stream = assembly.GetManifestResourceStream(resourceName);
            if (stream == null)
            {
                _logger.LogWarning("Could not load migration resource: {ResourceName}", resourceName);
                continue;
            }

            using var reader = new StreamReader(stream);
            var sql = await reader.ReadToEndAsync();

            await using var tx = await conn.BeginTransactionAsync();
            try
            {
                var statements = SplitSqlStatements(sql);
                foreach (var stmt in statements)
                {
                    if (!string.IsNullOrWhiteSpace(stmt))
                        await conn.ExecuteAsync(stmt, transaction: tx);
                }

                await conn.ExecuteAsync(
                    "INSERT INTO _migrations (FileName) VALUES (@FileName)",
                    new { FileName = sqlFileName },
                    tx);

                await tx.CommitAsync();
                _logger.LogInformation("Migration {FileName} applied successfully", sqlFileName);
            }
            catch (Exception ex)
            {
                await tx.RollbackAsync();
                _logger.LogError(ex, "Failed to apply migration {FileName}", sqlFileName);
                throw;
            }
        }
    }

    /// <summary>
    /// Разбивает файл миграции на отдельные SQL-statements по «;». <c>internal</c> вместо
    /// <c>private</c> ради юнит-тестируемости (см. <c>InternalsVisibleTo</c> в csproj) — чистая
    /// функция без I/O.
    /// </summary>
    internal static List<string> SplitSqlStatements(string sql)
    {
        // Сначала вырезаем "--"-комментарии до конца строки — иначе ';' внутри текста комментария
        // ломает разбиение на statements.
        var withoutComments = string.Join('\n', sql
            .Split('\n')
            .Select(StripLineComment));

        return withoutComments.Split(';', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => s.Trim())
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .ToList();
    }

    /// <summary>Обрезает строку на первом вхождении «--» (SQL line comment), если оно есть.</summary>
    private static string StripLineComment(string line)
    {
        var idx = line.IndexOf("--", StringComparison.Ordinal);
        return idx < 0 ? line : line[..idx];
    }
}
