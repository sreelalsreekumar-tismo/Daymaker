import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  ApiTokenInfo, AppNotification, Attachment, CalendarEvent, Category, Folder, GoogleCalendarInfo, GoogleStatus, Note,
  NoteInput, Preferences, SearchHit, Todo, TodoInput, TodoStatus,
} from './models';

const B = '/api/v1';

function params(o: Record<string, string | number | boolean | null | undefined>): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') p = p.set(k, String(v));
  return p;
}

/** Typed wrapper over the Daymaker REST API. */
@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);

  // todos
  todos(filter: Record<string, string | number | boolean | null | undefined> = {}) {
    return firstValueFrom(this.http.get<Todo[]>(`${B}/todos`, { params: params(filter) }));
  }
  todo(id: number) { return firstValueFrom(this.http.get<Todo>(`${B}/todos/${id}`)); }
  subtasks(id: number) { return firstValueFrom(this.http.get<Todo[]>(`${B}/todos/${id}/subtasks`)); }
  createTodo(t: TodoInput) { return firstValueFrom(this.http.post<Todo>(`${B}/todos`, t)); }
  updateTodo(id: number, t: TodoInput) { return firstValueFrom(this.http.put<Todo>(`${B}/todos/${id}`, t)); }
  completeTodo(id: number) { return firstValueFrom(this.http.post<{ completed: number; next: number | null }>(`${B}/todos/${id}/complete`, {})); }
  setTodoStatus(id: number, status: TodoStatus, sortOrder?: number) {
    return firstValueFrom(this.http.patch<void>(`${B}/todos/${id}/status`, { status, sortOrder }));
  }
  toggleChecklist(todoId: number, itemId: number, done: boolean) {
    return firstValueFrom(this.http.put<void>(`${B}/todos/${todoId}/checklist/${itemId}`, done));
  }
  deleteTodo(id: number) { return firstValueFrom(this.http.delete<void>(`${B}/todos/${id}`)); }

  categories() { return firstValueFrom(this.http.get<Category[]>(`${B}/categories`)); }
  createCategory(name: string, color: string) { return firstValueFrom(this.http.post<Category>(`${B}/categories`, { name, color })); }
  deleteCategory(id: number) { return firstValueFrom(this.http.delete<void>(`${B}/categories/${id}`)); }
  tags() { return firstValueFrom(this.http.get<string[]>(`${B}/tags`)); }

  // attachments (stored as BLOBs in SQLite)
  attachments(owner: 'Todo' | 'Note', ownerId: number) {
    return firstValueFrom(this.http.get<Attachment[]>(`${B}/attachments`, { params: params({ owner, ownerId }) }));
  }
  uploadAttachment(owner: 'Todo' | 'Note', ownerId: number, file: File) {
    const fd = new FormData();
    fd.append('file', file);
    return firstValueFrom(this.http.post<Attachment>(`${B}/attachments`, fd, { params: params({ owner, ownerId }) }));
  }
  attachmentBlob(id: number) { return firstValueFrom(this.http.get(`${B}/attachments/${id}/content`, { responseType: 'blob' })); }
  deleteAttachment(id: number) { return firstValueFrom(this.http.delete<void>(`${B}/attachments/${id}`)); }

  // notes
  notes(filter: Record<string, string | number | boolean | null | undefined> = {}) {
    return firstValueFrom(this.http.get<Note[]>(`${B}/notes`, { params: params(filter) }));
  }
  note(id: number) { return firstValueFrom(this.http.get<Note>(`${B}/notes/${id}`)); }
  createNote(n: NoteInput) { return firstValueFrom(this.http.post<Note>(`${B}/notes`, n)); }
  updateNote(id: number, n: NoteInput) { return firstValueFrom(this.http.put<Note>(`${B}/notes/${id}`, n)); }
  pinNote(id: number, pinned: boolean) { return firstValueFrom(this.http.post<void>(`${B}/notes/${id}/pin`, pinned)); }
  deleteNote(id: number) { return firstValueFrom(this.http.delete<void>(`${B}/notes/${id}`)); }
  noteFromTodo(todoId: number) { return firstValueFrom(this.http.post<Note>(`${B}/notes/from-todo/${todoId}`, {})); }
  checklistToTodo(noteId: number, text: string) {
    return firstValueFrom(this.http.post<{ todoId: number }>(`${B}/notes/${noteId}/checklist-to-todo`, { text }));
  }
  folders() { return firstValueFrom(this.http.get<Folder[]>(`${B}/folders`)); }
  createFolder(name: string) { return firstValueFrom(this.http.post<Folder>(`${B}/folders`, { name })); }
  deleteFolder(id: number) { return firstValueFrom(this.http.delete<void>(`${B}/folders/${id}`)); }

  // calendar / google
  events(from: Date, to: Date) {
    return firstValueFrom(this.http.get<CalendarEvent[]>(`${B}/calendar/events`, { params: params({ from: from.toISOString(), to: to.toISOString() }) }));
  }
  googleStatus() { return firstValueFrom(this.http.get<GoogleStatus>(`${B}/google/status`)); }
  googleConnectUrl() { return firstValueFrom(this.http.get<{ url: string }>(`${B}/google/connect-url`)); }
  googleDisconnect() { return firstValueFrom(this.http.post<void>(`${B}/google/disconnect`, {})); }
  googleCalendars() { return firstValueFrom(this.http.get<GoogleCalendarInfo[]>(`${B}/google/calendars`)); }
  googleSettings(selectedCalendars: string[], twoWaySync: boolean) {
    return firstValueFrom(this.http.put<void>(`${B}/google/settings`, { selectedCalendars, twoWaySync }));
  }
  googleSync() { return firstValueFrom(this.http.post<{ added: number; changed: number; removed: number; lastSyncUtc: string | null; lastError: string | null }>(`${B}/google/sync`, {})); }

  // notifications
  notifications() { return firstValueFrom(this.http.get<{ unread: number; items: AppNotification[] }>(`${B}/notifications`)); }
  markRead(id: number) { return firstValueFrom(this.http.post<void>(`${B}/notifications/${id}/read`, {})); }
  markAllRead() { return firstValueFrom(this.http.post<void>(`${B}/notifications/read-all`, {})); }
  deleteNotification(id: number) { return firstValueFrom(this.http.delete<void>(`${B}/notifications/${id}`)); }
  clearNotifications() { return firstValueFrom(this.http.delete<void>(`${B}/notifications`)); }

  // preferences, search, tokens
  preferences() { return firstValueFrom(this.http.get<Preferences>(`${B}/preferences`)); }
  savePreferences(p: Preferences) { return firstValueFrom(this.http.put<Preferences>(`${B}/preferences`, p)); }
  search(q: string, kinds?: string) { return firstValueFrom(this.http.get<SearchHit[]>(`${B}/search`, { params: params({ q, kinds, limit: 8 }) })); }
  apiTokens() { return firstValueFrom(this.http.get<ApiTokenInfo[]>(`${B}/auth/tokens`)); }
  createApiToken(name: string, canWrite: boolean, canDelete: boolean) {
    return firstValueFrom(this.http.post<{ token: string }>(`${B}/auth/tokens`, { name, canWrite, canDelete }));
  }
  deleteApiToken(id: number) { return firstValueFrom(this.http.delete<void>(`${B}/auth/tokens/${id}`)); }
}
