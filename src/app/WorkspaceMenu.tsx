import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DdvClient } from '../protocol/client';
import { loadFile, saveFile, type RemotePath } from '../protocol/files';
import { useWorkspace, workspaceFingerprint } from '../store/workspace';
import { useSeriesData } from '../store/seriesData';
import { useSelection } from '../store/selection';
import { Menu, type MenuItem } from './Menu';
import { ConfirmDialog } from './ConfirmDialog';
import { FileDialog } from '../files/FileDialog';
import {
  forgetFile,
  lastFolder,
  recentFiles,
  rememberFile,
  remapPath,
  remapRecents,
  samePath,
} from '../files/recent';

const SAVE_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘S' : 'Ctrl+S';

/** A workspace waiting on the user agreeing to lose the one that is open. */
interface PendingLoad {
  readonly text: string;
  readonly name: string;
  readonly file: RemotePath | null;
}

/**
 * Save and load the workspace in the Flutter app's JSON format: on the server
 * through the remote file dialog, or locally by clipboard, text or file. The
 * server file a workspace came from is remembered, so Save writes back to it
 * and the toolbar marks changes made since.
 */
export function WorkspaceMenu({ client }: { client: DdvClient }) {
  const saveWorkspace = useWorkspace((s) => s.saveWorkspace);
  const loadWorkspace = useWorkspace((s) => s.loadWorkspace);
  const markSaved = useWorkspace((s) => s.markSaved);
  const currentFile = useWorkspace((s) => s.currentFile);
  const instrumentName = useWorkspace((s) => s.instrument?.name ?? null);
  const windowCount = useWorkspace((s) => Object.keys(s.windows).length);
  // Changed since it was loaded or saved; a workspace that never was has no baseline.
  const dirty = useWorkspace(
    (s) => s.savedFingerprint !== null && workspaceFingerprint(s) !== s.savedFingerprint,
  );
  const neverSaved = useWorkspace((s) => s.savedFingerprint === null);
  const clearData = useSeriesData((s) => s.clear);
  const clearSelection = useSelection((s) => s.clearSelection);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [remote, setRemote] = useState<{ mode: 'load' | 'save'; folder: RemotePath } | null>(null);
  const [pasted, setPasted] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [recents, setRecents] = useState<RemotePath[]>(recentFiles);
  const [pending, setPending] = useState<PendingLoad | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // What a load would throw away, or null when the open workspace is safely on the server.
  const loss =
    windowCount > 0 && (dirty || neverSaved)
      ? `Loading replaces the ${windowCount} window${windowCount === 1 ? '' : 's'} in this workspace, ` +
        (neverSaved ? 'which has not been saved.' : 'which has unsaved changes.')
      : null;

  // The toolbar already names the file and the instrument, so success is a word
  // that fades; only what the user has to read (progress, problems) stays put.
  const flash = useCallback((text: string) => {
    setMessage(text);
    window.setTimeout(() => setMessage((m) => (m === text ? null : m)), 2500);
  }, []);

  const load = async ({ text, name, file }: PendingLoad) => {
    // Switching instrument can take a while; say what is happening meanwhile.
    setWorking(true);
    setMessage(`Loading ${name}…`);
    try {
      // Data goes only once the file has parsed, so a bad file leaves the charts alone.
      const skipped = await loadWorkspace(client, text, () => {
        clearData();
        clearSelection();
      });
      markSaved(file);
      if (file) setRecents(rememberFile(file));
      if (skipped.length)
        setMessage(
          `Skipped ${skipped.length} window${skipped.length === 1 ? '' : 's'}: ${skipped.map((s) => s.reason).join('; ')}`,
        );
      else flash(file ? 'Loaded' : `Loaded ${name}`); // a server file's name is beside the menu
    } catch (e) {
      setMessage(`Could not load ${name}: ${(e as Error).message}`);
    } finally {
      setWorking(false);
    }
  };
  /** Load, asking first when the open workspace would be lost. */
  const requestLoad = (next: PendingLoad) => (loss ? setPending(next) : void load(next));

  const saveTo = useCallback(
    async (file: RemotePath) => {
      setWorking(true);
      setMessage(`Saving ${file.at(-1)}…`);
      try {
        await saveFile(client, file, saveWorkspace(true));
        markSaved(file);
        setRecents(rememberFile(file));
        flash('Saved');
      } catch (e) {
        setMessage(`Could not save ${file.at(-1)}: ${(e as Error).message}`);
      } finally {
        setWorking(false);
      }
    },
    [client, saveWorkspace, markSaved, flash],
  );

  const openDialog = useCallback((mode: 'load' | 'save') => {
    const file = useWorkspace.getState().currentFile;
    setRemote({ mode, folder: file ? file.slice(0, -1) : lastFolder() });
  }, []);

  // Ctrl/Cmd+S saves back to the workspace's file, or asks for one the first time.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 's')
        return;
      e.preventDefault();
      if (document.querySelector('.dialog-backdrop')) return; // a dialog has the floor
      const file = useWorkspace.getState().currentFile;
      if (file) void saveTo(file);
      else openDialog('save');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveTo, openDialog]);

  const loadRecent = async (file: RemotePath) => {
    const name = file.at(-1) ?? 'workspace';
    try {
      const { content } = await loadFile(client, file);
      requestLoad({ text: content, name, file });
    } catch (e) {
      // Renamed, moved or deleted since: it is no use in the list any more.
      setRecents(forgetFile(file));
      setMessage(`Could not load ${file.join('/')}: ${(e as Error).message}`);
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

  const items: MenuItem[] = [
    {
      label: 'Save',
      hint: SAVE_KEY,
      disabled: !currentFile,
      title: currentFile ? `Save to ${currentFile.join('/')}` : 'Not saved on the server yet',
      onClick: () => currentFile && void saveTo(currentFile),
    },
    { label: 'Save as…', onClick: () => openDialog('save') },
    { label: 'Load from server…', onClick: () => openDialog('load') },
    ...(recents.length
      ? [
          { heading: 'Recent' },
          ...recents.map((file) => ({
            label: file.at(-1) ?? '',
            hint: file.slice(0, -1).join('/'),
            title: `Load ${file.join('/')}`,
            onClick: () => void loadRecent(file),
          })),
        ]
      : []),
    { separator: true },
    {
      label: 'Copy JSON to clipboard',
      onClick: () =>
        void navigator.clipboard.writeText(saveWorkspace()).then(() => flash('Copied')),
    },
    { label: 'Download JSON file', onClick: download },
    { label: 'Load from text…', onClick: () => setPasteOpen(true) },
    { label: 'Load from file…', onClick: () => fileInput.current?.click() },
  ];

  return (
    <>
      <Menu label="Workspace" icon="folder" items={items} />
      {currentFile && (
        <span
          className="meta current-file"
          aria-label={`${currentFile.join('/')}${dirty ? ', unsaved changes' : ''}`}
          title={`${currentFile.join('/')}${dirty ? ` — unsaved changes (${SAVE_KEY} saves)` : ''}`}
        >
          {currentFile.at(-1)}
          {dirty && <span className="dirty"> ●</span>}
        </span>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Workspace file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) requestLoad({ text: await f.text(), name: f.name, file: null });
        }}
      />
      {message && (
        <span
          className="meta workspace-message"
          role="status"
          onClick={() => !working && setMessage(null)}
          title={working ? undefined : 'Dismiss'}
        >
          {working && <span className="spinner" />}
          {message}
        </span>
      )}
      {remote && (
        <FileDialog
          client={client}
          mode={remote.mode}
          content={remote.mode === 'save' ? saveWorkspace(true) : undefined}
          initialPath={remote.folder}
          initialName={currentFile?.at(-1)}
          currentInstrument={instrumentName}
          confirmLoad={loss}
          onPathChanged={(from, to) => {
            // Keep Save and the recents pointing at files that were renamed or moved.
            setRecents(remapRecents(from, to));
            const { currentFile: file, retargetFile } = useWorkspace.getState();
            if (!file) return;
            const moved = remapPath(file, from, to);
            if (!moved || !samePath(moved, file)) retargetFile(moved);
          }}
          onCancel={() => setRemote(null)}
          onDone={({ text, path }) => {
            setRemote(null);
            if (text !== undefined) {
              void load({ text, name: path.at(-1) ?? 'workspace', file: path });
            } else {
              markSaved(path);
              setRecents(rememberFile(path));
              flash('Saved');
            }
          }}
        />
      )}
      {pending && (
        <ConfirmDialog
          title={`Load ${pending.name}?`}
          message={loss ?? 'Loading replaces this workspace.'}
          confirmLabel="Load"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            setPending(null);
            void load(pending);
          }}
        />
      )}
      {pasteOpen &&
        createPortal(
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
                  onClick={() => {
                    setPasteOpen(false);
                    requestLoad({ text: pasted, name: 'pasted workspace', file: null });
                    setPasted('');
                  }}
                >
                  Load
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
