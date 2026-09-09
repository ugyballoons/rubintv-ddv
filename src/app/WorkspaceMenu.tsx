import { useRef, useState } from 'react';
import type { DdvClient } from '../protocol/client';
import { useWorkspace } from '../store/workspace';
import { useSeriesData } from '../store/seriesData';
import { useSelection } from '../store/selection';
import { Menu } from './Menu';

/**
 * Save and load the workspace in the Flutter app's JSON format. Clipboard and
 * local file for now; the remote file dialog over the websocket comes later.
 */
export function WorkspaceMenu({ client }: { client: DdvClient }) {
  const saveWorkspace = useWorkspace((s) => s.saveWorkspace);
  const loadWorkspace = useWorkspace((s) => s.loadWorkspace);
  const clearData = useSeriesData((s) => s.clear);
  const clearSelection = useSelection((s) => s.clearSelection);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async (text: string) => {
    try {
      clearData();
      clearSelection();
      const skipped = await loadWorkspace(client, text);
      setMessage(
        skipped.length
          ? `Loaded; skipped ${skipped.length} window(s): ${skipped.map((s) => s.reason).join('; ')}`
          : 'Workspace loaded',
      );
    } catch (e) {
      setMessage(`Could not load workspace: ${(e as Error).message}`);
    }
  };

  const download = () => {
    const blob = new Blob([saveWorkspace(true)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ddv-workspace-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Menu
        label="Workspace"
        items={[
          {
            label: 'Copy JSON to clipboard',
            onClick: () =>
              void navigator.clipboard.writeText(saveWorkspace()).then(() => setMessage('Copied')),
          },
          { label: 'Download JSON file', onClick: download },
          { label: 'Load from text…', onClick: () => setPasteOpen(true) },
          { label: 'Load from file…', onClick: () => fileInput.current?.click() },
        ]}
      />
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Workspace file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) await load(await f.text());
        }}
      />
      {message && (
        <span className="meta" role="status" onClick={() => setMessage(null)} title="Dismiss">
          {message}
        </span>
      )}
      {pasteOpen && (
        <div className="dialog-backdrop" onMouseDown={() => setPasteOpen(false)}>
          <div
            className="dialog"
            role="dialog"
            aria-label="Load workspace from text"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h3>Load workspace from text</h3>
            <textarea
              aria-label="Workspace JSON"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={12}
              placeholder="Paste workspace JSON"
            />
            <div className="buttons">
              <button onClick={() => setPasteOpen(false)}>Cancel</button>
              <button
                onClick={async () => {
                  setPasteOpen(false);
                  await load(pasted);
                  setPasted('');
                }}
              >
                Load
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
