import { create } from 'zustand';
import type { DdvClient } from '../protocol/client';
import { loadInstrument } from '../protocol/commands';
import { parseInstrument, type Instrument } from '../model/schema';

export type InstrumentStatus = 'none' | 'loading' | 'ready';

interface WorkspaceState {
  instrument: Instrument | null;
  instrumentStatus: InstrumentStatus;
  selectInstrument(client: DdvClient, name: string | null): Promise<void>;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  instrument: null,
  instrumentStatus: 'none',
  async selectInstrument(client, name) {
    if (!name) {
      set({ instrument: null, instrumentStatus: 'none' });
      return;
    }
    set({ instrumentStatus: 'loading' });
    const info = await loadInstrument(client, name);
    set({ instrument: parseInstrument(info), instrumentStatus: 'ready' });
  },
}));
