import { useState } from 'react';
import { parseDataIdKey } from 'rubin-charts';
import type { DdvClient } from '../protocol/client';
import { KNOWN_INSTRUMENTS } from '../model/schema';
import { CHART_WINDOW_TYPES, WINDOW_TITLES, type WindowType } from '../model/workspace';
import { describe as describeQuery } from '../model/query';
import { useConnection } from '../store/connection';
import { useWorkspace } from '../store/workspace';
import { useSeriesData } from '../store/seriesData';
import { useSelection } from '../store/selection';
import { APP_VERSION } from '../config';
import { Menu } from './Menu';
import { WorkspaceMenu } from './WorkspaceMenu';
import { QueryEditor } from '../query/QueryEditor';
import { Icon } from './Icon';
import { NightPicker } from './NightPicker';

/** Connection dot: red disconnected, amber connected without an instrument, green ready. */
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
      style={{ background: color, color }}
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
  const query = useWorkspace((s) => s.globalQuery.query);
  const detectorId = useWorkspace((s) => s.globalQuery.detectorId);
  const setGlobalQuery = useWorkspace((s) => s.setGlobalQuery);
  const clearData = useSeriesData((s) => s.clear);
  const selectedCount = useSelection((s) => s.selected.size);
  const clearSelection = useSelection((s) => s.clearSelection);
  const [queryOpen, setQueryOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const requestReloadAll = useSeriesData((s) => s.requestReloadAll);
  const loadingInstrument = instrumentStatus === 'loading';
  const hasWindows = Object.keys(windows).length > 0;
  const detectorLabel =
    detectorId === null
      ? ''
      : (instrument?.detectors.find((d) => d.id === detectorId)?.name ?? String(detectorId));

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? null : n)), 2500);
  };

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
      <span className="brand">
        <StatusDot />
        RubinTV DDV
      </span>
      <select
        aria-label="Instrument"
        value={instrument?.name ?? ''}
        disabled={connection !== 'open' || instrumentStatus === 'loading'}
        onChange={(e) => void changeInstrument(e.target.value || null)}
      >
        <option value="">Select instrument…</option>
        {KNOWN_INSTRUMENTS.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      {loadingInstrument && (
        <span className="meta loading-instrument" role="status">
          <span className="spinner" /> Loading schema and geometry…
        </span>
      )}
      <span className="sep" />
      <Menu
        label="Add chart"
        icon="chart"
        items={[...CHART_WINDOW_TYPES, 'focalPlane' as WindowType].map((t: WindowType) => ({
          label: WINDOW_TITLES[t],
          onClick: () => addWindow(t),
        }))}
        disabled={!instrument?.database}
      />
      <WorkspaceMenu client={client} />
      <span className="sep" />
      <NightPicker client={client} />
      <button
        onClick={() => setQueryOpen(true)}
        disabled={!instrument?.database}
        title={query ? describeQuery(query) : 'Filter every chart that uses the global query'}
        style={
          query
            ? {
                borderColor: 'var(--accent)',
                color: 'var(--accent-ink)',
                background: 'var(--accent-soft)',
              }
            : undefined
        }
      >
        <Icon name="filter" />
        Global query{query ? ' ●' : ''}
      </button>
      <button
        onClick={() => addWindow('detectorSelector')}
        disabled={!instrument}
        title="Pick the current detector on the focal plane"
      >
        <Icon name="detector" />
        Detector{detectorLabel ? `: ${detectorLabel}` : ''}
      </button>
      <span className="sep" />
      <button
        onClick={() => {
          const ids = [...useSelection.getState().selected].map((k) => parseDataIdKey(k));
          void navigator.clipboard
            .writeText(`[${ids.map((d) => `(${d.dayObs}, ${d.seqNum})`).join(',')}]`)
            .then(
              () =>
                flash(
                  `Copied ${ids.length.toLocaleString()} exposure${ids.length === 1 ? '' : 's'}`,
                ),
              () => flash('Clipboard unavailable'),
            );
        }}
        disabled={selectedCount === 0}
        title="Copy the selected exposures to the clipboard as (dayObs, seqNum) pairs"
      >
        <Icon name="copy" />
        Copy
      </button>
      <button
        onClick={clearSelection}
        disabled={selectedCount === 0}
        title="Clear the selection in every chart"
      >
        <Icon name="clear" />
        Clear selection{selectedCount ? ` (${selectedCount.toLocaleString()})` : ''}
      </button>
      <button
        onClick={requestReloadAll}
        disabled={!hasWindows}
        title="Fetch every chart's data again"
      >
        <Icon name="sync" />
        Refresh
      </button>
      {notice && (
        <span className="meta notice" role="status">
          {notice}
        </span>
      )}
      <span className="spacer meta" title={`v${APP_VERSION} · ${client.url}`}>
        v{APP_VERSION}
      </span>
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
        <Icon name="trash" />
        Clear workspace
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
    </header>
  );
}
