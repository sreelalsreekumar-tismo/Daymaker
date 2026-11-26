using Daymaker.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Data;

public class DaymakerDbContext(DbContextOptions<DaymakerDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<UserPreferences> Preferences => Set<UserPreferences>();
    public DbSet<GoogleConnection> GoogleConnections => Set<GoogleConnection>();
    public DbSet<Category> Categories => Set<Category>();
    public DbSet<Tag> Tags => Set<Tag>();
    public DbSet<TodoItem> Todos => Set<TodoItem>();
    public DbSet<ChecklistItem> ChecklistItems => Set<ChecklistItem>();
    public DbSet<Folder> Folders => Set<Folder>();
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<Attachment> Attachments => Set<Attachment>();
    public DbSet<CalendarEvent> CalendarEvents => Set<CalendarEvent>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<ApiToken> ApiTokens => Set<ApiToken>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().HasIndex(u => u.GoogleSubject).IsUnique();
        b.Entity<User>().HasOne(u => u.Preferences).WithOne().HasForeignKey<UserPreferences>(p => p.UserId);
        b.Entity<User>().HasOne(u => u.Google).WithOne().HasForeignKey<GoogleConnection>(g => g.UserId);
        b.Entity<TodoItem>().HasMany(t => t.Subtasks).WithOne().HasForeignKey(t => t.ParentId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<TodoItem>().HasMany(t => t.Checklist).WithOne().HasForeignKey(c => c.TodoItemId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<TodoItem>().HasIndex(t => new { t.UserId, t.Status });
        b.Entity<TodoTag>().HasKey(x => new { x.TodoItemId, x.TagId });
        b.Entity<TodoItem>().HasMany(t => t.Tags).WithOne().HasForeignKey(x => x.TodoItemId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<NoteTag>().HasKey(x => new { x.NoteId, x.TagId });
        b.Entity<Note>().HasMany(n => n.Tags).WithOne().HasForeignKey(x => x.NoteId).OnDelete(DeleteBehavior.Cascade);
        b.Entity<Attachment>().HasIndex(a => new { a.OwnerType, a.OwnerId });
        b.Entity<CalendarEvent>().HasIndex(e => new { e.UserId, e.GoogleEventId }).IsUnique();
        b.Entity<Notification>().HasIndex(n => new { n.UserId, n.Read });
        b.Entity<ApiToken>().HasIndex(t => t.Hash).IsUnique();
    }
}
