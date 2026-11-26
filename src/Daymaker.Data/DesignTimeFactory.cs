using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Daymaker.Data;

public class DesignTimeFactory : IDesignTimeDbContextFactory<DaymakerDbContext>
{
    public DaymakerDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<DaymakerDbContext>()
            .UseSqlite("Data Source=daymaker.db")
            .Options;
        return new DaymakerDbContext(options);
    }
}
