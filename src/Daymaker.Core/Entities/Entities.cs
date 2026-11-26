namespace Daymaker.Core.Entities;

public enum TodoStatus { ToDo = 0, InProgress = 1, Completed = 2 }
public enum Priority { Low = 0, Medium = 1, High = 2, Urgent = 3 }
public enum Recurrence { None = 0, Daily = 1, Weekly = 2, Monthly = 3 }
public enum NotificationType { TaskUpdated, DeadlineApproaching, Reminder, MeetingAdded, MeetingChanged, DailySummary, Sync }
public enum AttachmentOwner { Todo, Note }

public class User
{
    public int Id { get; set; }
    public string GoogleSubject { get; set; } = "";
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public string? PictureUrl { get; set; }
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public UserPreferences Preferences { get; set; } = new();
    public GoogleConnection? Google { get; set; }
}

public class UserPreferences
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Theme { get; set; } = "system";        // light|dark|system
    public string Accent { get; set; } = "#4f46e5";
    public string FontSize { get; set; } = "medium";     // small|medium|large
    public string Spacing { get; set; } = "comfortable"; // compact|comfortable
    public string TodoLayout { get; set; } = "list";     // list|grid|kanban
    public string NoteLayout { get; set; } = "grid";     // grid|list|document
    public bool NotifyDeadlines { get; set; } = true;
    public bool NotifyMeetings { get; set; } = true;
    public bool NotifyTaskUpdates { get; set; } = true;
    public bool NotifyDailySummary { get; set; } = true;
}

public class GoogleConnection
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string RefreshTokenProtected { get; set; } = "";
    public string? SyncToken { get; set; }
    public string SelectedCalendars { get; set; } = "primary"; // comma separated ids
    public bool TwoWaySync { get; set; } = true;
    public DateTime? LastSyncUtc { get; set; }
    public string? LastError { get; set; }
}

public class Category
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#64748b";
}

public class Tag
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Name { get; set; } = "";
}

public class TodoItem
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public int? ParentId { get; set; }
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public DateTime? DueUtc { get; set; }
    public DateTime? ReminderUtc { get; set; }
    public bool ReminderSent { get; set; }
    public bool DeadlineNotified { get; set; }
    public Priority Priority { get; set; } = Priority.Medium;
    public TodoStatus Status { get; set; } = TodoStatus.ToDo;
    public int? CategoryId { get; set; }
    public Category? Category { get; set; }
    public Recurrence Recurrence { get; set; }
    public string? GoogleEventId { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime? CompletedUtc { get; set; }
    public List<ChecklistItem> Checklist { get; set; } = new();
    public List<TodoTag> Tags { get; set; } = new();
    public List<TodoItem> Subtasks { get; set; } = new();
}

public class ChecklistItem
{
    public int Id { get; set; }
    public int TodoItemId { get; set; }
    public string Text { get; set; } = "";
    public bool Done { get; set; }
    public int SortOrder { get; set; }
}

public class TodoTag
{
    public int TodoItemId { get; set; }
    public int TagId { get; set; }
    public Tag Tag { get; set; } = null!;
}

public class Folder
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Name { get; set; } = "";
}

public class Note
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Title { get; set; } = "";
    public string ContentHtml { get; set; } = "";
    public bool Pinned { get; set; }
    public int? FolderId { get; set; }
    public int? SourceTodoId { get; set; }
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedUtc { get; set; } = DateTime.UtcNow;
    public List<NoteTag> Tags { get; set; } = new();
}

public class NoteTag
{
    public int NoteId { get; set; }
    public int TagId { get; set; }
    public Tag Tag { get; set; } = null!;
}

public class Attachment
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public AttachmentOwner OwnerType { get; set; }
    public int OwnerId { get; set; }
    public string FileName { get; set; } = "";
    public string ContentType { get; set; } = "";
    public long Size { get; set; }
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

public class CalendarEvent
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string GoogleEventId { get; set; } = "";
    public string CalendarId { get; set; } = "primary";
    public string Title { get; set; } = "";
    public string Description { get; set; } = "";
    public string? Location { get; set; }
    public DateTime StartUtc { get; set; }
    public DateTime EndUtc { get; set; }
    public bool AllDay { get; set; }
    public string? ETag { get; set; }
    public int? LinkedTodoId { get; set; }
    public DateTime UpdatedUtc { get; set; } = DateTime.UtcNow;
}

public class Notification
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public NotificationType Type { get; set; }
    public string Title { get; set; } = "";
    public string Message { get; set; } = "";
    public string? LinkKind { get; set; }  // todo|event|note
    public int? LinkId { get; set; }
    public bool Read { get; set; }
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

public class ApiToken
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Name { get; set; } = "";
    public string Hash { get; set; } = "";
    public bool CanWrite { get; set; } = true;
    public bool CanDelete { get; set; }
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime? LastUsedUtc { get; set; }
}
