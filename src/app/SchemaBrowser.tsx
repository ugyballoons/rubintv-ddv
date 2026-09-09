import { useWorkspace } from '../store/workspace';

const KIND_LABEL: Record<string, string> = {
  number: 'num',
  string: 'str',
  datetime: 'time',
  boolean: 'bool',
};

/** Lists the loaded instrument's tables and columns, the raw material for series editors later. */
export function SchemaBrowser() {
  const instrument = useWorkspace((s) => s.instrument);
  if (!instrument) {
    return <p style={{ color: '#7a8a91' }}>Select an instrument to load its schema.</p>;
  }
  if (!instrument.database) {
    return (
      <p style={{ color: '#b5651d' }}>
        The worker has no database connection for {instrument.name}; only detector geometry (
        {instrument.detectors.length} detectors) was returned.
      </p>
    );
  }
  return (
    <section>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: '#4b5c64' }}>
        <b>{instrument.name}</b> · database <code>{instrument.database}</code> ·{' '}
        {instrument.tables.length} tables · {instrument.detectors.length} detectors
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {instrument.tables.map((t) => (
          <article
            key={t.name}
            style={{ border: '1px solid #d3dcde', borderRadius: 6, padding: '8px 12px' }}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: 15 }}>{t.name}</h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13 }}>
              {t.columns.map((c) => (
                <li
                  key={c.id}
                  title={c.description}
                  style={{ display: 'flex', gap: 8, padding: '2px 0' }}
                >
                  <code style={{ width: 34, color: '#7a8a91' }}>{KIND_LABEL[c.kind]}</code>
                  <span>{c.name}</span>
                  {c.unit && <span style={{ color: '#7a8a91' }}>({c.unit})</span>}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
