using System.Reflection;
using CreditCalc.Api.Data;
using FluentAssertions;

namespace CreditCalc.Api.Tests;

/// <summary>
/// Тесты <see cref="MigrationRunner.SplitSqlStatements"/> — наивный сплит по ';' ломается, если
/// внутри '--'-комментария есть точка с запятой. Порт сценариев из
/// bonds/tests/Bonds.Tests/MigrationRunnerTests.cs.
/// </summary>
public class MigrationRunnerTests
{
    [Fact]
    public void SemicolonInsideLineComment_DoesNotSplitThere_OneStatement()
    {
        const string sql = "-- note: this comment contains a semicolon; right here\nDELETE FROM mortgages;";

        var statements = MigrationRunner.SplitSqlStatements(sql);

        statements.Should().ContainSingle().Which.Trim().Should().Be("DELETE FROM mortgages");
    }

    [Fact]
    public void MultipleStatementsWithCommentsBetween_SplitsCorrectly()
    {
        const string sql = """
            -- first statement; note the semicolon in this comment
            CREATE TABLE foo (id INT);
            -- second statement; another semicolon in a comment
            CREATE TABLE bar (id INT);
            """;

        var statements = MigrationRunner.SplitSqlStatements(sql);

        statements.Should().HaveCount(2);
        statements[0].Should().Contain("CREATE TABLE foo");
        statements[1].Should().Contain("CREATE TABLE bar");
        statements.Should().OnlyContain(s => !s.Contains("--"));
    }

    [Fact]
    public void NoComments_BehavesAsPlainSemicolonSplit()
    {
        const string sql = "CREATE TABLE a (id INT); CREATE TABLE b (id INT);";

        var statements = MigrationRunner.SplitSqlStatements(sql);

        statements.Should().HaveCount(2);
    }

    [Fact]
    public void CommentOnlyContent_ProducesNoStatements()
    {
        const string sql = "-- just a comment, no sql at all\n-- another comment; with a semicolon";

        var statements = MigrationRunner.SplitSqlStatements(sql);

        statements.Should().BeEmpty();
    }

    [Fact]
    public void TrailingLineCommentAfterStatement_DoesNotBreakSplit()
    {
        const string sql = "DELETE FROM foo; -- cleanup; done";

        var statements = MigrationRunner.SplitSqlStatements(sql);

        statements.Should().ContainSingle().Which.Trim().Should().Be("DELETE FROM foo");
    }

    [Fact]
    public void UserSettingsMigration_SplitsIntoExactlyOneStatement()
    {
        var assembly = Assembly.GetAssembly(typeof(MigrationRunner))!;
        var resourceName = assembly.GetManifestResourceNames()
            .Single(n => n.EndsWith("002_user_settings.sql"));

        using var stream = assembly.GetManifestResourceStream(resourceName)!;
        using var reader = new StreamReader(stream);
        var sql = reader.ReadToEnd();

        var statements = MigrationRunner.SplitSqlStatements(sql);

        statements.Should().ContainSingle();
    }

    [Fact]
    public void MortgageDeductionsMigration_SplitsIntoExactlyOneStatement()
    {
        var assembly = Assembly.GetAssembly(typeof(MigrationRunner))!;
        var resourceName = assembly.GetManifestResourceNames()
            .Single(n => n.EndsWith("003_mortgage_deductions.sql"));

        using var stream = assembly.GetManifestResourceStream(resourceName)!;
        using var reader = new StreamReader(stream);
        var sql = reader.ReadToEnd();

        var statements = MigrationRunner.SplitSqlStatements(sql);

        statements.Should().ContainSingle();
    }
}
