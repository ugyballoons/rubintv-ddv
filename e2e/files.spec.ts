import { expect, test } from './helpers';

test('workspaces can be saved to, browsed, renamed, duplicated, deleted and loaded from the server', async ({
  app,
  page,
}) => {
  const folder = `e2e-${Date.now().toString(36)}`;
  const win = await app.addChart('Histogram');
  await app.addSeries(win, { bottom: 'ra' });
  await app.waitLoaded(win);
  await page.getByRole('button', { name: /Workspace/ }).click();
  await page.getByRole('menuitem', { name: 'Save to server…' }).click();
  const save = page.getByRole('dialog', { name: 'Save workspace to server' });
  page.once('dialog', (d) => d.accept(folder));
  await save.getByRole('button', { name: 'New folder' }).click();
  await save.getByRole('option', { name: `📁 ${folder}`, exact: true }).dblclick();
  await save.locator('input[aria-label="file name"]').fill('ws1.json');
  await save.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').last()).toContainText(`Saved ${folder}/ws1.json`);

  await page.getByRole('button', { name: /Workspace/ }).click();
  await page.getByRole('menuitem', { name: 'Load from server…' }).click();
  const load = page.getByRole('dialog', { name: 'Load workspace from server' });
  await load.getByRole('option', { name: `📁 ${folder}`, exact: true }).dblclick();
  await load.getByRole('option', { name: '📄 ws1.json', exact: true }).click();
  await load.getByRole('button', { name: 'Rename' }).click();
  await load.locator('input[aria-label="new name"]').fill('histogram.json');
  await page.keyboard.press('Enter');
  await load.getByRole('option', { name: '📄 histogram.json', exact: true }).click();
  await load.getByRole('button', { name: 'Duplicate' }).click();
  await expect(load.locator('.file-row')).toHaveCount(2);
  await load.getByRole('option', { name: '📄 histogram.json_copy', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await load.getByRole('button', { name: 'Delete' }).click();
  await expect(load.locator('.file-row')).toHaveCount(1);
  await load.getByRole('button', { name: 'Cancel' }).click();

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Clear workspace' }).click();
  await expect(app.windows).toHaveCount(0);
  await page.getByRole('button', { name: /Workspace/ }).click();
  await page.getByRole('menuitem', { name: 'Load from server…' }).click();
  await load.getByRole('option', { name: `📁 ${folder}`, exact: true }).dblclick();
  await load.getByRole('option', { name: '📄 histogram.json', exact: true }).dblclick();
  await expect(app.windows).toHaveCount(1);
  await app.waitLoaded(app.windows.first());

  // tidy up on the server
  await page.getByRole('button', { name: /Workspace/ }).click();
  await page.getByRole('menuitem', { name: 'Load from server…' }).click();
  await load.getByRole('option', { name: `📁 ${folder}`, exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await load.getByRole('button', { name: 'Delete' }).click();
  await expect(load.getByRole('option', { name: `📁 ${folder}`, exact: true })).toHaveCount(0);
});
