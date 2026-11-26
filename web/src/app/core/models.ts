export type TodoStatus = 'ToDo' | 'InProgress' | 'Completed';
export type Priority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type Recurrence = 'None' | 'Daily' | 'Weekly' | 'Monthly';

export const STATUSES: { value: TodoStatus; label: string }[] = [
  { value: 'ToDo', label: 'To do' },
  { value: 'InProgress', label: 'In progress' },
  { value: 'Completed', label: 'Completed' },
];
export const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Urgent'];

export interface ChecklistItem { id?: number; text: string; done: boolean }

export interface Todo {
  id: number;
  parentId: number | null;
  title: string;
  description: string;
  dueUtc: string | null;
  reminderUtc: string | null;
  priority: Priority;
  status: TodoStatus;
  categoryId: number | null;
  categoryName: string | null;
  categoryColor: string | null;
  recurrence: Recurrence;
  googleEventId: string | null;
  sortOrder: number;
  createdUtc: string;
  completedUtc: string | null;
  tags: string[];
  checklist: ChecklistItem[];
  subtaskCount: number;
  subtasksDone: number;
  attachmentCount: number;
  syncError?: string | null;
}

export interface TodoInput {
  title: string;
  description?: string | null;
  dueUtc?: string | null;
  reminderUtc?: string | null;
  priority?: Priority;
  status?: TodoStatus;
  categoryId?: number | null;
  recurrence?: Recurrence;
  parentId?: number | null;
  tags?: string[];
  checklist?: ChecklistItem[];
  addToCalendar?: boolean;
}

export interface Category { id: number; name: string; color: string }

export interface Attachment { id: number; fileName: string; contentType: string; size: number }

export interface Note {
  id: number;
  title: string;
  contentHtml: string;
  pinned: boolean;
  folderId: number | null;
  sourceTodoId: number | null;
  tags: string[];
  createdUtc: string;
  updatedUtc: string;
  attachmentCount: number;
}
export interface NoteInput { title: string; contentHtml?: string; pinned?: boolean; folderId?: number | null; tags?: string[] }
export interface Folder { id: number; name: string }

export interface CalendarEvent {
  id: number;
  title: string;
  description: string;
  location: string | null;
  allDay: boolean;
  calendarId: string;
  linkedTodoId: number | null;
  startUtc: string;
  endUtc: string;
}

export interface EventInput {
  title: string;
  description?: string;
  startUtc: string;
  endUtc: string;
  allDay?: boolean;
  reminderMinutes?: number | null;
}

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  linkKind: 'todo' | 'event' | 'note' | null;
  linkId: number | null;
  read: boolean;
  createdUtc: string;
}

export interface Preferences {
  theme: 'light' | 'dark' | 'system';
  accent: string;
  fontSize: 'small' | 'medium' | 'large';
  spacing: 'compact' | 'comfortable';
  todoLayout: 'list' | 'grid' | 'kanban';
  noteLayout: 'grid' | 'list' | 'document';
  notifyDeadlines: boolean;
  notifyMeetings: boolean;
  notifyTaskUpdates: boolean;
  notifyDailySummary: boolean;
}

export interface GoogleStatus {
  configured: boolean;
  connected: boolean;
  selectedCalendars: string[];
  twoWaySync: boolean;
  lastSyncUtc: string | null;
  lastError: string | null;
}
export interface GoogleCalendarInfo { id: string; name: string; primary: boolean; selected: boolean }

export interface SearchHit { kind: 'todo' | 'note' | 'event' | 'attachment'; id: number; title: string; snippet: string; date: string | null; parentId: number | null }

export interface ApiTokenInfo { id: number; name: string; canWrite: boolean; canDelete: boolean; createdUtc: string; lastUsedUtc: string | null }
