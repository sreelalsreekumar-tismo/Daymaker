import { Injectable, signal } from '@angular/core';
import { Todo, TodoInput } from './models';

export interface EditorRequest { todo?: Todo; defaults?: Partial<TodoInput>; }

/** Cross-page coordination: which todo is open in the editor, and a version counter pages watch to reload after changes. */
@Injectable({ providedIn: 'root' })
export class TodoStore {
  readonly version = signal(0);
  readonly editor = signal<EditorRequest | null>(null);

  changed() { this.version.update((v) => v + 1); }
  openNew(defaults?: Partial<TodoInput>) { this.editor.set({ defaults }); }
  openEdit(todo: Todo) { this.editor.set({ todo }); }
  close() { this.editor.set(null); }
}
