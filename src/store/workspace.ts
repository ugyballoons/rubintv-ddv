import { create } from 'zustand';
import type { DdvClient } from '../protocol/client';
import { loadInstrument } from '../protocol/commands';
import { parseInstrument, type Instrument } from '../model/schema';
import {
  DEFAULT_WINDOW_SIZE,
  NEW_WINDOW_OFFSET,
  WINDOW_TITLES,
  defaultChart,
  type ChartConfig,
  type WindowMeta,
  type WindowType,
} from '../model/workspace';
import type { QueryJson } from '../protocol/types';
import { parseWorkspace, serializeWorkspace, stringifyWorkspace } from '../model/workspaceJson';
import { SERIES_COLORS } from '../model/workspace';
import { APP_VERSION } from '../config';

export type InstrumentStatus = 'none' | 'loading' | 'ready';

export interface GlobalQuery {
  /** YYYY-MM-DD or null. */
  readonly dayObs: string | null;
  readonly query: QueryJson | null;
  readonly detectorId: number | null;
}

interface WorkspaceState {
  instrument: Instrument | null;
  instrumentStatus: InstrumentStatus;
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
  setGlobalQuery(patch: Partial<GlobalQuery>): void;
  clearWorkspace(): void;
  replaceWindows(windows: Record<string, WindowMeta>, globalQuery?: GlobalQuery): void;
  /** Serialise the workspace in the Flutter app's format. */
  saveWorkspace(pretty?: boolean): string;
  /** Load a saved workspace, switching instrument first if the file names a different one. Returns skipped windows. */
  loadWorkspace(
    client: DdvClient,
    text: string,
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

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  instrument: null,
  instrumentStatus: 'none',
  windows: {},
  nextZ: 1,
  globalQuery: { dayObs: null, query: null, detectorId: null },

  async selectInstrument(client, name) {
    if (!name) {
      set({ instrument: null, instrumentStatus: 'none' });
      return;
    }
    set({ instrumentStatus: 'loading' });
    const info = await loadInstrument(client, name);
    set({ instrument: parseInstrument(info), instrumentStatus: 'ready' });
  },

  addWindow(type) {
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
      ...DEFAULT_WINDOW_SIZE,
      z: nextZ,
      chart: defaultChart(type),
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

  setGlobalQuery(patch) {
    set((s) => ({ globalQuery: { ...s.globalQuery, ...patch } }));
  },

  clearWorkspace() {
    set({ windows: {}, globalQuery: { dayObs: null, query: null, detectorId: null } });
  },

  saveWorkspace(pretty = false) {
    const { windows, instrument, globalQuery } = get();
    return stringifyWorkspace(
      serializeWorkspace({
        windows,
        instrument,
        globalQuery: globalQuery.query,
        dayObs: globalQuery.dayObs,
        detectorId: globalQuery.detectorId,
        version: APP_VERSION,
        newId,
      }),
      pretty,
    );
  },

  async loadWorkspace(client, text) {
    // Peek at the instrument first so fields can be validated against its schema.
    const peek = parseWorkspace(text, null, SERIES_COLORS);
    if (peek.instrumentName && peek.instrumentName !== get().instrument?.name) {
      await get().selectInstrument(client, peek.instrumentName);
    }
    const file = parseWorkspace(text, get().instrument, SERIES_COLORS);
    get().replaceWindows(file.windows, {
      dayObs: file.dayObs,
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
