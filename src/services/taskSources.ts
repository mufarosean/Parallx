// taskSources.ts — tools that keep the user's tasks, for others to offer
//
// The dashboard's timer lets you pick open tasks to work on. It does not
// know any task tool: a tool that keeps tasks (the Planner) registers itself
// here while it runs, and the timer offers "Choose tasks" only while one is
// registered, naming it. Turned off, the source goes and the button with it.

import { Emitter, type Event } from '../platform/events.js';
import { toDisposable, type IDisposable } from '../platform/lifecycle.js';

export interface TaskSourceTask { readonly id: string; readonly title: string }

export interface TaskSource {
  /** Stable id (the registering tool's). */
  readonly id: string;
  /** The tool's name as the user knows it ("Planner"). */
  readonly name: string;
  /** Open tasks, overdue, future and undated alike. */
  listOpenTasks(): Promise<readonly TaskSourceTask[]>;
  /** Mark a task done (or open again) in the tool. */
  setDone(taskId: string, done: boolean): Promise<void>;
}

const _sources = new Map<string, TaskSource>();
const _onDidChange = new Emitter<void>();
export const onDidChangeTaskSources: Event<void> = _onDidChange.event;

export function registerTaskSource(source: TaskSource): IDisposable {
  _sources.set(source.id, source);
  _onDidChange.fire();
  return toDisposable(() => {
    if (_sources.get(source.id) === source) { _sources.delete(source.id); _onDidChange.fire(); }
  });
}

export function getTaskSources(): readonly TaskSource[] {
  return [..._sources.values()];
}
