import { useEffect, useMemo } from 'react';
import { websocketUrl } from './config';
import { DdvClient } from './protocol/client';
import { useConnection } from './store/connection';
import { Toolbar } from './app/Toolbar';
import { SchemaBrowser } from './app/SchemaBrowser';
import { ScatterSpike } from './app/ScatterSpike';

export default function App() {
  const client = useMemo(() => new DdvClient(websocketUrl()), []);
  const bind = useConnection((s) => s.bind);
  const lastError = useConnection((s) => s.lastError);

  useEffect(() => {
    const unbind = bind(client);
    client.connect();
    return () => {
      unbind();
      client.close();
    };
  }, [client, bind]);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', color: '#16262e' }}>
      <Toolbar client={client} />
      <main style={{ padding: 16 }}>
        {lastError && (
          <p role="alert" style={{ color: '#a63d3d' }}>
            {lastError.message}
          </p>
        )}
        <SchemaBrowser />
        <ScatterSpike client={client} />
      </main>
    </div>
  );
}
