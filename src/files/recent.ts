import type { RemotePath } from '../protocol/files';

/**
 * Where the user last was on the server, kept in localStorage so it outlives
 * a page reload. Files can be renamed or deleted behind these, so every reader
 * treats a path as a hint: a missing folder falls back to home and a missing
 * recent file is dropped when loading it fails.
 */
const RECENT_KEY = 'ddv.recentWorkspaces';
const FOLDER_KEY = 'ddv.lastFolder';
const MAX_RECENT = 8;

const isPath = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');

/** A small JSON preference; null when absent or unreadable. */
export function loadPref(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null; // unreadable or no storage: start afresh
  }
}
export function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full: recents are a convenience */
  }
}

export const samePath = (a: RemotePath, b: RemotePath) =>
  a.length === b.length && a.every((s, i) => s === b[i]);

export function recentFiles(): RemotePath[] {
  const v = loadPref(RECENT_KEY);
  return Array.isArray(v) ? v.filter(isPath).filter((p) => p.length > 0) : [];
}
/** Put a file at the head of the recents; returns the new list. */
export function rememberFile(file: RemotePath): RemotePath[] {
  const next = [file, ...recentFiles().filter((p) => !samePath(p, file))].slice(0, MAX_RECENT);
  savePref(RECENT_KEY, next);
  savePref(FOLDER_KEY, file.slice(0, -1));
  return next;
}
export function forgetFile(file: RemotePath): RemotePath[] {
  const next = recentFiles().filter((p) => !samePath(p, file));
  savePref(RECENT_KEY, next);
  return next;
}

export function lastFolder(): RemotePath {
  const v = loadPref(FOLDER_KEY);
  return isPath(v) ? v : [];
}
export function rememberFolder(folder: RemotePath): void {
  savePref(FOLDER_KEY, folder);
}

/** Where `p` ends up when `from` (a file, or a folder above it) becomes `to`; null when it was deleted. */
export function remapPath(
  p: RemotePath,
  from: RemotePath,
  to: RemotePath | null,
): RemotePath | null {
  if (!samePath(p.slice(0, from.length), from)) return p;
  return to ? [...to, ...p.slice(from.length)] : null;
}
/** Follow a rename, move or delete through the recents; returns the new list. */
export function remapRecents(from: RemotePath, to: RemotePath | null): RemotePath[] {
  const next = recentFiles()
    .map((p) => remapPath(p, from, to))
    .filter((p): p is RemotePath => p !== null);
  savePref(RECENT_KEY, next);
  return next;
}
