// fileTypes.ts — filesystem-related types
//
// Enums, interfaces, and error types used by IFileService and consumers.
// Mirrors VS Code's src/vs/platform/files/common/files.ts (subset for M4).

import type { URI } from './uri.js';


// ─── FileType ────────────────────────────────────────────────────────────────

/**
 * Classifies a filesystem entry.
 * Matches VS Code's `FileType` enum.
 */
export const enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

// ─── FileChangeType ──────────────────────────────────────────────────────────

/**
 * The type of change observed on a filesystem resource.
 */
export const enum FileChangeType {
  Created = 1,
  Changed = 2,
  Deleted = 3,
}

// ─── FileStat ────────────────────────────────────────────────────────────────

/**
 * Information about a filesystem entry.
 */
export interface FileStat {
  readonly type: FileType;
  readonly size: number;
  /** Modification time in milliseconds since epoch. */
  readonly mtime: number;
  /** Creation time in milliseconds since epoch. */
  readonly ctime: number;
  readonly isReadonly: boolean;
  /** The URI this stat describes. */
  readonly uri: URI;
}

// ─── FileContent ─────────────────────────────────────────────────────────────

/**
 * The content of a file read from disk.
 */
export interface FileContent {
  readonly content: string;
  readonly encoding: string;
  readonly size: number;
  /** Modification time in milliseconds since epoch (for conflict detection). */
  readonly mtime: number;
}

// ─── FileEntry ───────────────────────────────────────────────────────────────

/**
 * A directory listing entry (returned by readdir).
 */
export interface FileEntry {
  readonly name: string;
  readonly uri: URI;
  readonly type: FileType;
  readonly size: number;
  readonly mtime: number;
}

// ─── FileChangeEvent ─────────────────────────────────────────────────────────

/**
 * Describes a single file system change.
 */
export interface FileChangeEvent {
  readonly type: FileChangeType;
  readonly uri: URI;
}

// ─── FileOperationError ──────────────────────────────────────────────────────

/**
 * File operation error codes.
 */
export const enum FileOperationErrorCode {
  /** File or directory not found. */
  FILE_NOT_FOUND = 'ENOENT',
  /** Permission denied. */
  FILE_PERMISSION_DENIED = 'EACCES',
  /** Entry already exists. */
  FILE_EXISTS = 'EEXIST',
  /** Attempted file operation on a directory. */
  FILE_IS_DIRECTORY = 'EISDIR',
  /** Attempted directory operation on a file. */
  FILE_NOT_DIRECTORY = 'ENOTDIR',
  /** Directory is not empty (delete without recursive). */
  FILE_NOT_EMPTY = 'ENOTEMPTY',
  /** File exceeds size limit. */
  FILE_TOO_LARGE = 'ETOOLARGE',
  /** Filesystem not available (no Electron bridge). */
  FILE_UNAVAILABLE = 'EUNAVAILABLE',
  /** Watcher limit reached. */
  FILE_WATCHER_LIMIT = 'ELIMIT',
  /** Unknown error. */
  FILE_UNKNOWN = 'EUNKNOWN',
}

/**
 * Error thrown by filesystem operations.
 */
export class FileOperationError extends Error {
  readonly code: string;
  readonly uri: URI | undefined;

  constructor(message: string, code: string, uri?: URI) {
    super(message);
    this.name = 'FileOperationError';
    this.code = code;
    this.uri = uri;
  }

  static isNotFound(err: unknown): boolean {
    return err instanceof FileOperationError && err.code === FileOperationErrorCode.FILE_NOT_FOUND;
  }

  static isPermissionDenied(err: unknown): boolean {
    return err instanceof FileOperationError && err.code === FileOperationErrorCode.FILE_PERMISSION_DENIED;
  }

  static isExists(err: unknown): boolean {
    return err instanceof FileOperationError && err.code === FileOperationErrorCode.FILE_EXISTS;
  }
}

// ─── File Delete Options ─────────────────────────────────────────────────────

export interface FileDeleteOptions {
  readonly recursive?: boolean;
  readonly useTrash?: boolean;
}

// ─── File Watcher ────────────────────────────────────────────────────────────

/** Info stored per active watcher. */
export interface FileWatcherHandle {
  readonly watchId: string;
  readonly uri: URI;
}

// ─── Dialog Types ────────────────────────────────────────────────────────────

/** File filter for open/save dialogs. */
export interface FileFilter {
  readonly name: string;
  readonly extensions: string[];
}

export interface OpenFileOptions {
  readonly multiSelect?: boolean;
  readonly filters?: FileFilter[];
  readonly defaultPath?: string;
}

export interface OpenFolderOptions {
  readonly multiSelect?: boolean;
  readonly defaultPath?: string;
}

export interface SaveFileOptions {
  readonly filters?: FileFilter[];
  readonly defaultPath?: string;
  readonly defaultName?: string;
}

export interface MessageBoxOptions {
  readonly type?: string;
  readonly title?: string;
  readonly message: string;
  readonly detail?: string;
  readonly buttons?: string[];
  readonly defaultId?: number;
  readonly cancelId?: number;
  readonly checkboxLabel?: string;
  readonly checkboxChecked?: boolean;
}

export interface MessageBoxResult {
  readonly response: number;
  readonly checkboxChecked: boolean;
}
