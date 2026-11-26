using Daymaker.Api.Auth;
using Daymaker.Core.Entities;
using Daymaker.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Api.Controllers;

public record CategoryInput(string Name, string? Color);

[ApiController, Authorize, Route("api/v1/categories")]
public class CategoriesController(DaymakerDbContext db, CurrentUser me) : ControllerBase
{
    [HttpGet] public async Task<IActionResult> List() => Ok(await db.Categories.Where(c => c.UserId == me.Id).OrderBy(c => c.Name).ToListAsync());

    [HttpPost, RequireScope("write")]
    public async Task<IActionResult> Create(CategoryInput i)
    {
        if (string.IsNullOrWhiteSpace(i.Name)) return BadRequest(new ProblemDetails { Title = "Name is required" });
        var c = new Category { UserId = me.Id, Name = i.Name.Trim(), Color = i.Color ?? "#64748b" };
        db.Categories.Add(c);
        await db.SaveChangesAsync();
        return Ok(c);
    }

    [HttpPut("{id:int}"), RequireScope("write")]
    public async Task<IActionResult> Update(int id, CategoryInput i)
    {
        var c = await db.Categories.FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.Id);
        if (c is null) return NotFound();
        c.Name = i.Name.Trim(); c.Color = i.Color ?? c.Color;
        await db.SaveChangesAsync();
        return Ok(c);
    }

    [HttpDelete("{id:int}"), RequireScope("delete")]
    public async Task<IActionResult> Delete(int id)
    {
        await db.Todos.Where(t => t.CategoryId == id && t.UserId == me.Id).ExecuteUpdateAsync(s => s.SetProperty(t => t.CategoryId, (int?)null));
        await db.Categories.Where(c => c.Id == id && c.UserId == me.Id).ExecuteDeleteAsync();
        return NoContent();
    }
}

[ApiController, Authorize, Route("api/v1/tags")]
public class TagsController(DaymakerDbContext db, CurrentUser me) : ControllerBase
{
    [HttpGet] public async Task<IActionResult> List() => Ok(await db.Tags.Where(t => t.UserId == me.Id).OrderBy(t => t.Name).Select(t => t.Name).ToListAsync());
}
