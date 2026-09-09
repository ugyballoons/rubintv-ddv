import { useEffect, useMemo } from 'react';
import './styles.css';
import { websocketUrl } from './config';
import { DdvClient } from './protocol/client';
import { useConnection } from './store/connection';
import { Toolbar } from './app/Toolbar';
import { WorkspaceView } from './workspace/WorkspaceView';
import { useWorkspace } from './store/workspace';
import { useSelection } from './store/selection';

// Dev-only hook for browser automation and debugging: window.__ddv.save() / load(text).
declare global {
  interface Window {
    __ddv?: { save(): string; load(text: string): Promise<unknown>; state(): unknown };
  }
}

export default function App() {
  const client = useMemo(() => new DdvClient(websocketUrl()), []);
  const bind = useConnection((s) => s.bind);
  const lastError = useConnection((s) => s.lastError);

  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__ddv = {
        save: () => useWorkspace.getState().saveWorkspace(true),
        load: (text) => useWorkspace.getState().loadWorkspace(client, text),
        state: () => {
          const sel = useSelection.getState();
          const ws = useWorkspace.getState();
          return {
            selected: sel.selected.size,
            preview: sel.preview?.size ?? null,
            drillDown: sel.drillDown?.size ?? null,
            windows: Object.values(ws.windows).map((w) => ({
              id: w.id,
              type: w.type,
              tool: w.chart?.tool,
              series: w.chart?.series.length,
            })),
          };
        },
      };
    }
    const unbind = bind(client);
    client.connect();
    return () => {
      unbind();
      client.close();
    };
  }, [client, bind]);

  return (
    <div className="app">
      <Toolbar client={client} />
      {lastError && (
        <p
          role="alert"
          style={{ margin: 0, padding: '4px 12px', color: 'var(--bad)', background: '#fff' }}
        >
          {lastError.message}
        </p>
      )}
      <WorkspaceView client={client} />
    </div>
  );
}
