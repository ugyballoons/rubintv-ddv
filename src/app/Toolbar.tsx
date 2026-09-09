import type { DdvClient } from '../protocol/client';
import { KNOWN_INSTRUMENTS } from '../model/schema';
import { CHART_WINDOW_TYPES, WINDOW_TITLES, type WindowType } from '../model/workspace';
import { useConnection } from '../store/connection';
import { useWorkspace } from '../store/workspace';
import { useSeriesData } from '../store/seriesData';
import { useSelection } from '../store/selection';
import { APP_VERSION } from '../config';
import { useState } from 'react';
import { Menu } from './Menu';
import { QueryEditor } from '../query/QueryEditor';
import { describe as describeQuery } from '../model/query';
import { WorkspaceMenu } from './WorkspaceMenu';

/** Connection dot: red disconnected, yellow connected without an instrument, green ready. */
function StatusDot() {
  const status = useConnection((s) => s.status);
  const instrumentStatus = useWorkspace((s) => s.instrumentStatus);
  const color =
    status !== 'open' ? 'var(--bad)' : instrumentStatus === 'ready' ? 'var(--good)' : '#c9a227';
  const label =
    status !== 'open' ? `connection ${status}` : `connection open, instrument ${instrumentStatus}`;
  return (
    <span
      className="status-dot"
      role="status"
      aria-label={label}
      title={label}
      style={{ background: color }}
    />
  );
}

export function Toolbar({ client }: { client: DdvClient }) {
  const connection = useConnection((s) => s.status);
  const instrument = useWorkspace((s) => s.instrument);
  const instrumentStatus = useWorkspace((s) => s.instrumentStatus);
  const selectInstrument = useWorkspace((s) => s.selectInstrument);
  const windows = useWorkspace((s) => s.windows);
  const addWindow = useWorkspace((s) => s.addWindow);
  const clearWorkspace = useWorkspace((s) => s.clearWorkspace);
  const dayObs = useWorkspace((s) => s.globalQuery.dayObs);
  const setGlobalQuery = useWorkspace((s) => s.setGlobalQuery);
  const clearData = useSeriesData((s) => s.clear);
  const selectedCount = useSelection((s) => s.selected.size);
  const clearSelection = useSelection((s) => s.clearSelection);
  const hasWindows = Object.keys(windows).length > 0;
  const query = useWorkspace((s) => s.globalQuery.query);
  const [queryOpen, setQueryOpen] = useState(false);

  const changeInstrument = async (name: string | null) => {
    if (hasWindows && !window.confirm('Changing the instrument clears the workspace. Continue?'))
      return;
    clearWorkspace();
    clearData();
    clearSelection();
    await selectInstrument(client, name);
  };

  return (
    <header className="toolbar">
      <StatusDot />
      <strong>RubinTV DDV</strong>
      <label>
        Instrument
        <select
          aria-label="Instrument"
          value={instrument?.name ?? ''}
          disabled={connection !== 'open' || instrumentStatus === 'loading'}
          onChange={(e) => void changeInstrument(e.target.value || null)}
        >
          <option value="">Select instrument</option>
          {KNOWN_INSTRUMENTS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <Menu
        label="Add chart"
        items={CHART_WINDOW_TYPES.map((t: WindowType) => ({
          label: WINDOW_TITLES[t],
          onClick: () => addWindow(t),
        }))}
      />
      <WorkspaceMenu client={client} />
      <label title="Restrict every chart that uses the global query to this observation night">
        Night
        <input
          type="date"
          aria-label="Observation night"
          value={dayObs ?? ''}
          onChange={(e) => setGlobalQuery({ dayObs: e.target.value || null })}
        />
      </label>
      <button
        onClick={() => setQueryOpen(true)}
        disabled={!instrument?.database}
        title={query ? describeQuery(query) : 'Filter every chart that uses the global query'}
        style={query ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
      >
        Global query{query ? ' ●' : ''}
      </button>
      {queryOpen && instrument && (
        <QueryEditor
          instrument={instrument}
          initial={query}
          title="Global query"
          onCancel={() => setQueryOpen(false)}
          onAccept={(q) => {
            setGlobalQuery({ query: q });
            setQueryOpen(false);
          }}
        />
      )}
      <button
        onClick={clearSelection}
        disabled={selectedCount === 0}
        title="Clear the selection in every chart"
      >
        Clear selection{selectedCount ? ` (${selectedCount.toLocaleString()})` : ''}
      </button>
      <button
        className="danger"
        disabled={!hasWindows}
        onClick={() => {
          if (window.confirm('Remove every window from the workspace?')) {
            clearWorkspace();
            clearData();
            clearSelection();
          }
        }}
      >
        Clear workspace
      </button>
      <span className="spacer meta" title={`v${APP_VERSION} · ${client.url}`}>
        v{APP_VERSION}
      </span>
    </header>
  );
}
