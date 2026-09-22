import { expect, test } from './helpers';

test('workspaces can be saved to, browsed, renamed, duplicated, moved, deleted and loaded from the server', async ({
  app,
  page,
}) => {
  const folder = `e2e-${Date.now().toString(36)}`;
  const menu = (item: string | RegExp) =>
    page
      .getByRole('button', { name: /Workspace/ })
      .click()
      .then(() => page.getByRole('menuitem', { name: item }).click());
  const currentFile = page.locator('.current-file');

  const win = await app.addChart('Histogram');
  await app.addSeries(win, { bottom: 'ra' });
  await app.waitLoaded(win);
  await page.getByRole('button', { name: /Workspace/ }).click();
  await expect(page.getByRole('menuitem', { name: /^Save/ }).first()).toBeDisabled(); // nowhere to save to yet
  await page.getByRole('menuitem', { name: 'Save as…' }).click();
  const save = page.getByRole('dialog', { name: 'Save workspace to server' });
  await save.getByRole('button', { name: 'home' }).click(); // wherever the last run left off
  await save.getByRole('button', { name: 'New folder' }).click();
  await save.getByLabel('new folder name').fill(folder);
  await page.keyboard.press('Enter');
  await save.getByRole('option', { name: `folder ${folder}`, exact: true }).dblclick();
  await save.locator('input[aria-label="file name"]').fill('ws1.json');
  await save.getByRole('button', { name: 'Save', exact: true }).click();
  // the toolbar names the workspace's file; the status is just a passing word
  await expect(page.getByRole('status').last()).toHaveText('Saved');
  await expect(currentFile).toHaveText('ws1.json');
  await expect(currentFile).toHaveAttribute('aria-label', `${folder}/ws1.json`);

  await menu('Load from server…');
  const load = page.getByRole('dialog', { name: 'Load workspace from server' });
  // the dialog reopens beside the workspace's file, which says what it holds
  const ws1 = load.getByRole('option', { name: 'file ws1.json', exact: true });
  await expect(ws1).toContainText('testdb');
  await expect(ws1).toContainText(/\d (B|KB)/);
  await load.getByRole('button', { name: 'home' }).click();
  // a selected folder turns the primary button into Open
  await expect(load.getByRole('button', { name: 'Load', exact: true })).toBeDisabled();
  await load.getByLabel('filter').fill(folder);
  await expect(load.locator('.file-row')).toHaveCount(1);
  await load.getByRole('option', { name: `folder ${folder}`, exact: true }).click();
  await load.getByRole('button', { name: 'Open', exact: true }).click();
  await ws1.click();
  await expect(load.locator('.file-about')).toContainText('testdb · 1 window · saved by v');
  await load.getByRole('button', { name: 'Rename' }).click();
  await load.locator('input[aria-label="new name"]').fill('histogram.json');
  await page.keyboard.press('Enter');
  await load.getByRole('option', { name: 'file histogram.json', exact: true }).click();
  await expect(currentFile).toHaveText('histogram.json'); // the workspace's file followed the rename
  await load.getByRole('button', { name: 'Duplicate' }).click();
  await expect(load.locator('.file-row')).toHaveCount(2);

  // drag the copy into a new subfolder, look, and drag it back out onto the breadcrumb
  const copy = load.getByRole('option', { name: 'file histogram.json_copy', exact: true });
  await load.getByRole('button', { name: 'New folder' }).click();
  await load.getByLabel('new folder name').fill('sub');
  await page.keyboard.press('Enter');
  const sub = load.getByRole('option', { name: 'folder sub', exact: true });
  await copy.dragTo(sub);
  await expect(copy).toHaveCount(0);
  await sub.dblclick();
  await expect(copy).toBeVisible();
  await copy.dragTo(load.getByRole('button', { name: folder, exact: true }));
  await expect(load.getByText('This folder is empty')).toBeVisible();
  await load.getByRole('button', { name: 'Up one folder' }).click();

  // deleting asks inside the dialog
  await copy.click();
  await load.getByRole('button', { name: 'Delete' }).click();
  await load.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(copy).toBeVisible();
  await load.getByRole('button', { name: 'Delete' }).click();
  await load.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(copy).toHaveCount(0);
  await load.getByRole('button', { name: 'Cancel' }).click();

  // an edit marks the workspace unsaved; Save writes it back to its file
  await expect(currentFile).toHaveAttribute('aria-label', `${folder}/histogram.json`);
  await win.getByLabel('bins').fill('7');
  await expect(currentFile).toHaveAttribute('aria-label', /unsaved changes/);
  await menu(/^Save(?! as)/);
  await expect(currentFile).toHaveAttribute('aria-label', `${folder}/histogram.json`);

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Clear workspace' }).click();
  await expect(app.windows).toHaveCount(0);
  await expect(currentFile).toHaveCount(0);

  // an unsaved workspace is not replaced without asking
  await app.addChart('Histogram');
  await menu('Load from server…');
  await load.getByRole('option', { name: 'file histogram.json', exact: true }).dblclick();
  await expect(load.getByRole('alertdialog')).toContainText('has not been saved');
  await load.getByRole('alertdialog').getByRole('button', { name: 'Load' }).click();
  await expect(app.windows).toHaveCount(1);
  await expect(app.windows.first().getByLabel('bins')).toHaveValue('7');
  await app.waitLoaded(app.windows.first());
  await expect(currentFile).toHaveAttribute('aria-label', `${folder}/histogram.json`);

  // and it is one click away afterwards, even after a reload
  await app.open();
  await menu('histogram.json');
  await expect(app.windows).toHaveCount(1);
  await expect(currentFile).toHaveText('histogram.json');
  await app.waitLoaded(app.windows.first());
  // loading the very same file again fetches its data again, rather than waiting for ever
  const before = app.sent.filter((c) => c.name === 'load columns').length;
  await menu('histogram.json');
  await expect
    .poll(() => app.sent.filter((c) => c.name === 'load columns').length)
    .toBeGreaterThan(before);
  await app.waitLoaded(app.windows.first());

  // tidy up on the server
  await menu('Load from server…');
  await load.getByRole('button', { name: 'Up one folder' }).click();
  await load.getByRole('option', { name: `folder ${folder}`, exact: true }).click();
  await load.getByRole('button', { name: 'Delete' }).click();
  await load.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(load.getByRole('option', { name: `folder ${folder}`, exact: true })).toHaveCount(0);
  await expect(currentFile).toHaveCount(0); // its file went with the folder
});
