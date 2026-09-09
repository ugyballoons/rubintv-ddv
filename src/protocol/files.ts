import type { DdvClient } from './client';

/**
 * Remote file commands on the worker's user directory. Paths are lists of
 * segments relative to that directory. The service reports failures inside
 * `content.error` with a success `type`, so every call checks for it.
 */
export type RemotePath = readonly string[];

export interface DirectoryListing {
  readonly path: RemotePath;
  readonly files: readonly string[];
  readonly directories: readonly string[];
}

async function call<T extends object>(
  client: DdvClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const env = await client.request<T & { error?: string }>(name, parameters);
  if (
    env.content &&
    typeof env.content === 'object' &&
    'error' in env.content &&
    env.content.error
  ) {
    throw new Error(String(env.content.error));
  }
  return env.content;
}

export const listDirectory = (client: DdvClient, path: RemotePath) =>
  call<DirectoryListing>(client, 'list directory', { path });
export const createDirectory = (client: DdvClient, path: RemotePath, name: string) =>
  call<{ path: string }>(client, 'create directory', { path, name });
export const renameFile = (client: DdvClient, path: RemotePath, newName: string) =>
  call<{ new_path: string }>(client, 'rename', { path, new_name: newName });
export const deleteFile = (client: DdvClient, path: RemotePath) =>
  call<{ deleted_path: RemotePath; type: 'file' | 'directory' }>(client, 'delete', { path });
export const duplicateFile = (client: DdvClient, path: RemotePath) =>
  call<{ new_filename?: string; new_path?: string }>(client, 'duplicate', { path });
export const moveFile = (client: DdvClient, source: RemotePath, destination: RemotePath) =>
  call<{ destination_path: RemotePath }>(client, 'move', {
    source_path: source,
    destination_path: destination,
  });
export const saveFile = (client: DdvClient, path: RemotePath, content: string) =>
  call<{ saved_path: string }>(client, 'save', { path, content });
export const loadFile = (client: DdvClient, path: RemotePath) =>
  call<{ content: string; path: RemotePath; size: number }>(client, 'load', { path });
