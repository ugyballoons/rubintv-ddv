import { useEffect, useMemo } from 'react';
import { APP_VERSION, websocketUrl } from './config';
import { DdvClient } from './protocol/client';
import { useConnection } from './store/connection';
import { StatusDot } from './app/StatusDot';

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
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, height: 40 }}>
        <StatusDot />
        <strong>RubinTV DDV</strong>
        <span style={{ color: '#7a8a91', fontSize: 13 }}>v{APP_VERSION}</span>
        <code style={{ marginLeft: 'auto', fontSize: 12, color: '#7a8a91' }}>{client.url}</code>
      </header>
      {lastError && (
        <p role="alert" style={{ color: '#a63d3d' }}>
          {lastError.message}
        </p>
      )}
    </div>
  );
}
