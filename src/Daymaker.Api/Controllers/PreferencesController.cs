using Daymaker.Api.Auth;
using Daymaker.Core.Entities;
using Daymaker.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Api.Controllers;

public record PreferencesDto(string Theme, string Accent, string FontSize, string Spacing, string TodoLayout, string NoteLayout,
    bool NotifyDeadlines, bool NotifyMeetings, bool NotifyTaskUpdates, bool NotifyDailySummary);

[ApiController, Authorize, Route("api/v1/preferences")]
public class PreferencesController(DaymakerDbContext db, CurrentUser me) : ControllerBase
{
    private static readonly string[] Themes = ["light", "dark", "system"], Sizes = ["small", "medium", "large"],
        Spacings = ["compact", "comfortable"], TodoLayouts = ["list", "grid", "kanban"], NoteLayouts = ["grid", "list", "document"];

    private static PreferencesDto ToDto(UserPreferences p) => new(p.Theme, p.Accent, p.FontSize, p.Spacing, p.TodoLayout, p.NoteLayout,
        p.NotifyDeadlines, p.NotifyMeetings, p.NotifyTaskUpdates, p.NotifyDailySummary);

    [HttpGet]
    public async Task<IActionResult> Get() => Ok(ToDto(await db.Preferences.AsNoTracking().FirstAsync(p => p.UserId == me.Id)));

    [HttpPut, RequireScope("write")]
    public async Task<IActionResult> Update(PreferencesDto d)
    {
        if (!Themes.Contains(d.Theme) || !Sizes.Contains(d.FontSize) || !Spacings.Contains(d.Spacing) ||
            !TodoLayouts.Contains(d.TodoLayout) || !NoteLayouts.Contains(d.NoteLayout) ||
            !System.Text.RegularExpressions.Regex.IsMatch(d.Accent, "^#[0-9a-fA-F]{6}$"))
            return BadRequest(new ProblemDetails { Title = "Invalid preference value" });
        var p = await db.Preferences.FirstAsync(x => x.UserId == me.Id);
        p.Theme = d.Theme; p.Accent = d.Accent; p.FontSize = d.FontSize; p.Spacing = d.Spacing;
        p.TodoLayout = d.TodoLayout; p.NoteLayout = d.NoteLayout;
        p.NotifyDeadlines = d.NotifyDeadlines; p.NotifyMeetings = d.NotifyMeetings;
        p.NotifyTaskUpdates = d.NotifyTaskUpdates; p.NotifyDailySummary = d.NotifyDailySummary;
        await db.SaveChangesAsync();
        return Ok(ToDto(p));
    }
}
