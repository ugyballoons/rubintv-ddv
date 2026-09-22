import { afterEach, describe, expect, it } from 'vitest';
import { forgetFile, lastFolder, recentFiles, rememberFile } from './recent';

describe('recent workspaces', () => {
  afterEach(() => localStorage.clear());

  it('keeps the newest first, without repeats, and remembers the folder', () => {
    rememberFile(['a', 'one.json']);
    rememberFile(['two.json']);
    rememberFile(['a', 'one.json']);
    expect(recentFiles()).toEqual([['a', 'one.json'], ['two.json']]);
    expect(lastFolder()).toEqual(['a']);
    expect(forgetFile(['a', 'one.json'])).toEqual([['two.json']]);
  });

  it('keeps eight at most and survives junk in storage', () => {
    for (let i = 0; i < 12; i++) rememberFile([`f${i}.json`]);
    expect(recentFiles()).toHaveLength(8);
    expect(recentFiles()[0]).toEqual(['f11.json']);
    localStorage.setItem('ddv.recentWorkspaces', '{not json');
    localStorage.setItem('ddv.lastFolder', '"nope"');
    expect(recentFiles()).toEqual([]);
    expect(lastFolder()).toEqual([]);
  });
});
