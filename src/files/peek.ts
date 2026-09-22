import { SERIES_COLORS } from '../model/workspace';
import { parseWorkspace } from '../model/workspaceJson';
import { canonicalInstrumentName } from '../model/schema';

/** What a workspace file holds, read without loading it into the app. */
export type WorkspacePeek =
  | {
      readonly instrument: string | null;
      readonly windows: number;
      /** Version of the app that wrote it. */
      readonly version: string;
    }
  | { readonly error: string };

export function peekWorkspace(text: string): WorkspacePeek {
  try {
    // No instrument: nothing is validated against a schema, so every window counts.
    const file = parseWorkspace(text, null, SERIES_COLORS);
    const { major, minor, patch } = file.version;
    return {
      instrument: file.instrumentName ? canonicalInstrumentName(file.instrumentName) : null,
      windows: Object.keys(file.windows).length + file.skipped.length,
      version: `${major}.${minor}.${patch}`,
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[u]}`;
}

const DAY = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const TIME = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** Seconds since the epoch → "14:02" today, otherwise "3 Sep 2026"; `full` gives both. */
export function formatModified(seconds: number, full = false, now = new Date()): string {
  const d = new Date(seconds * 1000);
  if (full) return `${DAY.format(d)}, ${TIME.format(d)}`;
  return d.toDateString() === now.toDateString() ? TIME.format(d) : DAY.format(d);
}
