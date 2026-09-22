import { create } from 'zustand';
import type { DdvClient } from '../protocol/client';
import { loadInstrument } from '../protocol/commands';
import { canonicalInstrumentName, parseInstrument, type Instrument } from '../model/schema';
import {
  DEFAULT_WINDOW_SIZE,
  NEW_WINDOW_OFFSET,
  WINDOW_TITLES,
  defaultChart,
  defaultFocal,
  type FocalPlaneConfig,
  type ChartConfig,
  type WindowMeta,
  type WindowType,
} from '../model/workspace';
import type { QueryJson } from '../protocol/types';
import { NO_NIGHTS, nightsDayObsParam, type NightSelection } from '../model/nights';
import { parseWorkspace, serializeWorkspace, stringifyWorkspace } from '../model/workspaceJson';
import { SERIES_COLORS } from '../model/workspace';
import { APP_VERSION } from '../config';

export type InstrumentStatus = 'none' | 'loading' | 'ready';

export interface GlobalQuery {
  /** The night filter; `dayObs` below is derived from it for single nights. */
  readonly nights: NightSelection;
  /** YYYY-MM-DD when exactly one night is selected, else null. */
  readonly dayObs: string | null;
  readonly query: QueryJson | null;
  readonly detectorId: number | null;
}

interface WorkspaceState {
  instrument: Instrument | null;
  instrumentStatus: InstrumentStatus;
  /** Name of the instrument being loaded, so the drop-down can show it before the reply lands. */
  pendingInstrument: string | null;
  /** The server file this workspace was loaded from or last saved to. */
  currentFile: readonly string[] | null;
  /** Fingerprint of the workspace when it was last loaded or saved; null before either. */
  savedFingerprint: string | null;
  windows: Record<string, WindowMeta>;
  nextZ: number;
  globalQuery: GlobalQuery;

  selectInstrument(client: DdvClient, name: string | null): Promise<void>;
  addWindow(type: WindowType): string;
  removeWindow(id: string): void;
  moveWindow(id: string, x: number, y: number): void;
  resizeWindow(id: string, x: number, y: number, width: number, height: number): void;
  focusWindow(id: string): void;
  updateChart(id: string, patch: Partial<ChartConfig> | ((c: ChartConfig) => ChartConfig)): void;
  updateFocal(id: string, patch: Partial<FocalPlaneConfig>): void;
  setGlobalQuery(patch: Partial<GlobalQuery>): void;
  clearWorkspace(): void;
  /** Record that the workspace as it stands is what `file` holds (null: loaded from somewhere without a name). */
  markSaved(file: readonly string[] | null): void;
  /** The workspace's file was renamed or moved on the server, or deleted (null: no longer saved anywhere). */
  retargetFile(file: readonly string[] | null): void;
  replaceWindows(windows: Record<string, WindowMeta>, globalQuery?: GlobalQuery): void;
  /** Serialise the workspace in the Flutter app's format. */
  saveWorkspace(pretty?: boolean): string;
  /**
   * Load a saved workspace, switching instrument first if the file names a different one. Returns skipped windows.
   * `beforeReplace` runs once the file is known to be good, in the same breath as
   * the windows being swapped: the place to drop the old workspace's data.
   */
  loadWorkspace(
    client: DdvClient,
    text: string,
    beforeReplace?: () => void,
  ): Promise<readonly { id: string; reason: string }[]>;
}

let idCounter = 0;
/** Ids are strings of a monotonically increasing counter, as in the Flutter UniqueId. */
export function newId(): string {
  idCounter += 1;
  return String(idCounter);
}
export function bumpIdCounterPast(id: string): void {
  const n = Number(id);
  if (Number.isFinite(n) && n >= idCounter) idCounter = n;
}

/**
 * A stable digest of what a save would hold, for the unsaved-changes marker.
 * The saved JSON itself won't do: writing it mints fresh query-node ids. Stacking
 * order is left out so that clicking a window does not count as a change.
 */
export function workspaceFingerprint(
  s: Pick<WorkspaceState, 'windows' | 'globalQuery' | 'instrument'>,
): string {
  return JSON.stringify([
    s.instrument?.name ?? null,
    s.globalQuery,
    Object.values(s.windows).map((w) => ({ ...w, z: 0 })),
  ]);
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  instrument: null,
  instrumentStatus: 'none',
  pendingInstrument: null,
  currentFile: null,
  savedFingerprint: null,
  windows: {},
  nextZ: 1,
  globalQuery: { nights: NO_NIGHTS, dayObs: null, query: null, detectorId: null },

  async selectInstrument(client, name) {
    if (!name) {
      set({ instrument: null, instrumentStatus: 'none', pendingInstrument: null });
      return;
    }
    const canonical = canonicalInstrumentName(name);
    set({ instrumentStatus: 'loading', pendingInstrument: canonical });
    try {
      const info = await loadInstrument(client, canonical);
      set({
        instrument: parseInstrument(info),
        instrumentStatus: 'ready',
        pendingInstrument: null,
      });
    } catch (e) {
      // Keep whatever was loaded before rather than spinning forever.
      set({ instrumentStatus: get().instrument ? 'ready' : 'none', pendingInstrument: null });
      throw e;
    }
  },

  addWindow(type) {
    if (type === 'detectorSelector') {
      const existing = Object.values(get().windows).find((w) => w.type === 'detectorSelector');
      if (existing) {
        get().focusWindow(existing.id);
        return existing.id;
      }
    }
    const id = newId();
    const { windows, nextZ } = get();
    // New windows stair-step from the most recent one, as in the Flutter app.
    const all = Object.values(windows);
    const last = all.length ? all.reduce((a, b) => (a.z > b.z ? a : b)) : null;
    const x = NEW_WINDOW_OFFSET.x + (last?.x ?? 0);
    const y = NEW_WINDOW_OFFSET.y + (last?.y ?? 0);
    const w: WindowMeta = {
      id,
      type,
      title: WINDOW_TITLES[type],
      x,
      y,
      ...(type === 'detectorSelector' || type === 'focalPlane'
        ? { width: 560, height: 600 }
        : DEFAULT_WINDOW_SIZE),
      z: nextZ,
      chart: defaultChart(type),
      ...(defaultFocal(type) && { focal: defaultFocal(type) }),
    };
    set({ windows: { ...windows, [id]: w }, nextZ: nextZ + 1 });
    return id;
  },

  removeWindow(id) {
    const { [id]: _removed, ...rest } = get().windows;
    set({ windows: rest });
  },

  moveWindow(id, x, y) {
    set((s) => ({ windows: { ...s.windows, [id]: { ...s.windows[id], x, y } } }));
  },

  resizeWindow(id, x, y, width, height) {
    set((s) => ({ windows: { ...s.windows, [id]: { ...s.windows[id], x, y, width, height } } }));
  },

  focusWindow(id) {
    const { windows, nextZ } = get();
    const w = windows[id];
    if (!w || w.z === nextZ - 1) return;
    set({ windows: { ...windows, [id]: { ...w, z: nextZ } }, nextZ: nextZ + 1 });
  },

  updateChart(id, patch) {
    set((s) => {
      const w = s.windows[id];
      if (!w?.chart) return s;
      const chart = typeof patch === 'function' ? patch(w.chart) : { ...w.chart, ...patch };
      return { windows: { ...s.windows, [id]: { ...w, chart } } };
    });
  },

  updateFocal(id, patch) {
    set((s) => {
      const w = s.windows[id];
      if (!w?.focal) return s;
      return { windows: { ...s.windows, [id]: { ...w, focal: { ...w.focal, ...patch } } } };
    });
  },

  setGlobalQuery(patch) {
    set((s) => {
      const merged = { ...s.globalQuery, ...patch };
      // A dayObs patch (e.g. from a loaded file) becomes a single-night selection; nights drive dayObs.
      if ('dayObs' in patch && !('nights' in patch)) {
        merged.nights = patch.dayObs
          ? { kind: 'single', night: Number(patch.dayObs.replace(/-/g, '')) }
          : NO_NIGHTS;
      }
      merged.dayObs = nightsDayObsParam(merged.nights);
      return { globalQuery: merged };
    });
  },

  markSaved(file) {
    set({ currentFile: file, savedFingerprint: workspaceFingerprint(get()) });
  },

  retargetFile(file) {
    set(file ? { currentFile: file } : { currentFile: null, savedFingerprint: null });
  },

  clearWorkspace() {
    set({
      currentFile: null,
      savedFingerprint: null,
      windows: {},
      globalQuery: { nights: NO_NIGHTS, dayObs: null, query: null, detectorId: null },
    });
  },

  saveWorkspace(pretty = false) {
    const { windows, instrument, globalQuery } = get();
    return stringifyWorkspace(
      serializeWorkspace({
        windows,
        instrument,
        globalQuery: globalQuery.query,
        dayObs: globalQuery.dayObs,
        nights: globalQuery.nights,
        detectorId: globalQuery.detectorId,
        version: APP_VERSION,
        newId,
      }),
      pretty,
    );
  },

  async loadWorkspace(client, text, beforeReplace) {
    // Peek at the instrument first so fields can be validated against its schema.
    const peek = parseWorkspace(text, null, SERIES_COLORS);
    if (
      peek.instrumentName &&
      canonicalInstrumentName(peek.instrumentName) !== get().instrument?.name
    ) {
      // As when the instrument is changed by hand: windows left open would
      // query the new instrument for the old one's columns.
      get().clearWorkspace();
      await get().selectInstrument(client, peek.instrumentName);
    }
    const file = parseWorkspace(text, get().instrument, SERIES_COLORS);
    beforeReplace?.();
    const nights: NightSelection =
      file.nights ??
      (file.dayObs ? { kind: 'single', night: Number(file.dayObs.replace(/-/g, '')) } : NO_NIGHTS);
    get().replaceWindows(file.windows, {
      nights,
      dayObs: nightsDayObsParam(nights),
      query: file.globalQuery,
      detectorId: file.detectorId,
    });
    return file.skipped;
  },

  replaceWindows(windows, globalQuery) {
    let maxZ = 0;
    for (const w of Object.values(windows)) {
      bumpIdCounterPast(w.id);
      for (const s of w.chart?.series ?? []) bumpIdCounterPast(s.id);
      if (w.z > maxZ) maxZ = w.z;
    }
    set({ windows, nextZ: maxZ + 1, ...(globalQuery && { globalQuery }) });
  },
}));
