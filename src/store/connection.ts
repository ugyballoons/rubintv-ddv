import { create } from 'zustand';
import type { ConnectionStatus, DdvClient, ProtocolError } from '../protocol/client';

interface ConnectionState {
  status: ConnectionStatus;
  lastError: ProtocolError | null;
  bind(client: DdvClient): () => void;
}

export const useConnection = create<ConnectionState>((set) => ({
  status: 'closed',
  lastError: null,
  bind(client) {
    set({ status: client.status });
    const offStatus = client.onStatus((status) => set({ status }));
    const offError = client.onError((lastError) => set({ lastError }));
    return () => {
      offStatus();
      offError();
    };
  },
}));
