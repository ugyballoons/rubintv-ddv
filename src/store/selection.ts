import { create } from 'zustand';
import type { DataIdKey } from 'rubin-charts';

const EMPTY: ReadonlySet<DataIdKey> = new Set();

interface SelectionState {
  /** Committed selection, last writer wins. */
  selected: ReadonlySet<DataIdKey>;
  /** Live, uncommitted selection broadcast during a drag; null when no drag is in progress. */
  preview: ReadonlySet<DataIdKey> | null;
  /** Window id that produced the current selection, so it can skip echoing it. */
  origin: string | null;
  drillDown: ReadonlySet<DataIdKey> | null;
  setSelection(ids: ReadonlySet<DataIdKey>, committed: boolean, origin: string): void;
  clearSelection(): void;
  setDrillDown(ids: ReadonlySet<DataIdKey> | null): void;
}

export const useSelection = create<SelectionState>((set) => ({
  selected: EMPTY,
  preview: null,
  origin: null,
  drillDown: null,
  setSelection(ids, committed, origin) {
    set(committed ? { selected: ids, preview: null, origin } : { preview: ids, origin });
  },
  clearSelection() {
    set({ selected: EMPTY, preview: null, origin: null });
  },
  setDrillDown(ids) {
    set({ drillDown: ids });
  },
}));

/** What charts should highlight right now: the live preview if a drag is in progress, else the committed set. */
export const effectiveSelection = (
  s: Pick<SelectionState, 'selected' | 'preview'>,
): ReadonlySet<DataIdKey> => s.preview ?? s.selected;
