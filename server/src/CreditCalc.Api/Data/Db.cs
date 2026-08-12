using System.Data;
using Dapper;
using MySqlConnector;

namespace CreditCalc.Api.Data;

/// <summary>
/// Фабрика соединений с MySQL. Строка подключения читается лениво из <see cref="IConfiguration"/>
/// при каждом вызове <see cref="Create"/> (а не один раз в конструкторе) — тот же паттерн,
/// что GetConnStr в bonds/Bonds.Infrastructure/DependencyInjection.cs: тесты, подменяющие
/// конфигурацию после регистрации DI (WebApplicationFactory.ConfigureWebHost), должны видеть
/// актуальное значение.
/// </summary>
public class Db
{
    private readonly IConfiguration _configuration;

    static Db()
    {
        // Кастомные Dapper TypeHandler'ы для DateOnly (Dapper из коробки его не поддерживает) —
        // регистрируются один раз в статическом конструкторе (Db — Singleton, конструктор
        // экземпляра гарантированно вызывается раньше первого использования Dapper).
        SqlMapper.AddTypeHandler(new DateOnlyTypeHandler());
        SqlMapper.AddTypeHandler(new NullableDateOnlyTypeHandler());

        // Колонки в БД — snake_case (property_price), свойства POCO — PascalCase (PropertyPrice).
        // MatchNamesWithUnderscores избавляет от ручных алиасов в каждом SELECT.
        Dapper.DefaultTypeMap.MatchNamesWithUnderscores = true;
    }

    public Db(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public MySqlConnection Create()
    {
        var connectionString = _configuration.GetConnectionString("DefaultConnection")
            ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection не настроена");
        return new MySqlConnection(connectionString);
    }
}

/// <summary>Dapper TypeHandler для System.DateOnly. Порт из bonds/Bonds.Infrastructure/DapperTypeHandlers.cs.</summary>
public class DateOnlyTypeHandler : SqlMapper.TypeHandler<DateOnly>
{
    public override void SetValue(IDbDataParameter parameter, DateOnly value)
    {
        parameter.DbType = DbType.Date;
        parameter.Value = value.ToDateTime(TimeOnly.MinValue);
    }

    public override DateOnly Parse(object value)
    {
        return value switch
        {
            DateTime dt => DateOnly.FromDateTime(dt),
            DateOnly d => d,
            string s => DateOnly.Parse(s),
            _ => DateOnly.FromDateTime(Convert.ToDateTime(value)),
        };
    }
}

/// <summary>Nullable-вариант <see cref="DateOnlyTypeHandler"/>.</summary>
public class NullableDateOnlyTypeHandler : SqlMapper.TypeHandler<DateOnly?>
{
    public override void SetValue(IDbDataParameter parameter, DateOnly? value)
    {
        parameter.DbType = DbType.Date;
        parameter.Value = value.HasValue
            ? value.Value.ToDateTime(TimeOnly.MinValue)
            : DBNull.Value;
    }

    public override DateOnly? Parse(object value)
    {
        if (value == null || value == DBNull.Value) return null;
        return value switch
        {
            DateTime dt => DateOnly.FromDateTime(dt),
            DateOnly d => d,
            string s => DateOnly.Parse(s),
            _ => DateOnly.FromDateTime(Convert.ToDateTime(value)),
        };
    }
}
