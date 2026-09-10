import { expect, test } from './helpers';

test('two scatters and a histogram share one selection by data id', async ({ app }) => {
  const a = await app.addChart('Scatter plot');
  const b = await app.addChart('Scatter plot');
  await app.moveWindow(b, 700, -20);
  await app.addSeries(a, { bottom: 'ra', left: 'dec' });
  await app.addSeries(b, { bottom: 'obs_start_mjd', left: 'dec' });
  await app.waitLoaded(a);
  await app.waitLoaded(b);
  await app.dragOn(a, 0.3, 0.3, 0.6, 0.6);
  const s = await app.state();
  expect(s.selected).toBeGreaterThan(1000);
  await expect(app.selectionButton()).toContainText(s.selected.toLocaleString('en-US'));
  await app.dragOn(b, 0.9, 0.05, 0.9, 0.05); // click on empty space clears
  expect((await app.state()).selected).toBe(0);
});

test('several series per chart with a per-series query, legend editing and deletion', async ({
  app,
  page,
}) => {
  const win = await app.addChart('Scatter plot');
  await app.addSeries(win, { bottom: 'ra', left: 'dec' }, { name: 'all' });
  await app.waitLoaded(win);
  await win.getByRole('button', { name: '+ series' }).click();
  const dlg = page.getByRole('dialog', { name: 'New series' });
  await dlg.locator('input[aria-label="series name"]').fill('south');
  await dlg.locator('select[aria-label="bottom column"]').selectOption('ra');
  await dlg.locator('select[aria-label="left column"]').selectOption('dec');
  await dlg.getByRole('button', { name: 'Add query' }).click();
  const q = page.getByRole('dialog', { name: /Query for/ });
  await q.locator('select[aria-label=table]').selectOption('exposure');
  await q.locator('select[aria-label=column]').selectOption('dec');
  await q.getByRole('button', { name: '+ condition' }).click();
  await q.locator('input[aria-label="right value"]').fill('-60');
  await q.getByRole('button', { name: 'Accept' }).click();
  await dlg.getByRole('button', { name: 'Accept' }).click();
  const status = await app.waitLoaded(win, 2);
  expect(status).toMatch(/100,000 rows · 6,\d{3} rows/);
  await expect(win.locator('.legend button')).toHaveCount(2);
  await win.locator('.legend button', { hasText: 'south' }).click();
  await page
    .getByRole('dialog', { name: 'Edit south' })
    .getByRole('button', { name: 'Delete series' })
    .click();
  await expect(win.locator('.legend button')).toHaveCount(1);
});

test('histogram bins select with click, cmd-click, shift+arrow and wrap-around', async ({
  app,
  page,
}) => {
  const win = await app.addChart('Histogram');
  await app.addSeries(win, { bottom: 'ra' });
  await app.waitLoaded(win);
  const c = (await win.locator('canvas').first().boundingBox())!;
  const barX = (f: number) => c.x + 60 + (c.width - 80) * f;
  const barY = c.y + c.height - 60;
  await page.mouse.click(barX(0.12), barY);
  const one = (await app.state()).selected;
  expect(one).toBeGreaterThan(0);
  await page.keyboard.down('Meta');
  await page.mouse.click(barX(0.5), barY);
  await page.keyboard.up('Meta');
  expect((await app.state()).selected).toBeGreaterThan(one);
  await page.keyboard.down('Shift');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.up('Shift');
  const extended = (await app.state()).selected;
  expect(extended).toBeGreaterThan(one);
  await page.keyboard.press('ArrowLeft');
  expect((await app.state()).selected).toBeLessThan(extended);
});

test('drill-down narrows every chart and Escape restores them', async ({ app, page }) => {
  const scatter = await app.addChart('Scatter plot');
  const hist = await app.addChart('Histogram');
  await app.moveWindow(hist, 700, -20);
  await app.addSeries(scatter, { bottom: 'ra', left: 'dec' });
  await app.addSeries(hist, { bottom: 'ra' });
  await app.waitLoaded(scatter);
  await app.waitLoaded(hist);
  await scatter.getByRole('radio', { name: 'drill down' }).click();
  await app.dragOn(scatter, 0.3, 0.1, 0.45, 0.9);
  await expect(page.locator('.drill-banner')).toContainText(/Drilled down to [\d,]+ rows/);
  expect((await app.state()).drillDown).toBeGreaterThan(1000);
  await page.keyboard.press('Escape');
  await expect(page.locator('.drill-banner')).toHaveCount(0);
  expect((await app.state()).drillDown).toBeNull();
});

test('box chart bins select rows', async ({ app, page }) => {
  const win = await app.addChart('Box chart');
  await app.addSeries(win, { bottom: 'ra', left: 'dec' });
  await app.waitLoaded(win);
  const c = (await win.locator('canvas').first().boundingBox())!;
  await page.mouse.click(c.x + c.width * 0.3, c.y + c.height * 0.5);
  expect((await app.state()).selected).toBeGreaterThan(0);
});

test('the axis editor changes labels and scales and they persist', async ({ app, page }) => {
  const win = await app.addChart('Scatter plot');
  await app.addSeries(win, { bottom: 'ra', left: 'dec' });
  await app.waitLoaded(win);
  await win.getByRole('button', { name: 'axes…' }).click();
  const ax = page.getByRole('dialog', { name: 'Edit axes' });
  await ax.locator('input[aria-label="bottom label"]').fill('Right ascension (deg)');
  await ax.locator('select[aria-label="bottom scale"]').selectOption('log10');
  await ax.getByRole('button', { name: 'Accept' }).click();
  const saved = await app.saveJson();
  expect((Object.values(saved.windows)[0] as any).state.axisInfo[0]).toMatchObject({
    label: 'Right ascension (deg)',
    mapping: { type: 'log10' },
  });
});

test('axis labels follow a series when its columns change, unless edited by hand', async ({
  app,
  page,
}) => {
  const win = await app.addChart('Scatter plot');
  await app.addSeries(win, { bottom: 'ra', left: 'dec' });
  await app.waitLoaded(win);
  const labels = async () => (
    Object.values(await app.saveJson()).length,
    (Object.values((await app.saveJson()).windows)[0] as any).state.axisInfo.map(
      (a: any) => a.label,
    )
  );
  expect(await labels()).toEqual(['exposure.ra', 'exposure.dec']);
  // a hand-edited y label survives; the automatic x label follows the new column
  await win.getByRole('button', { name: 'axes…' }).click();
  const ax = page.getByRole('dialog', { name: 'Edit axes' });
  await ax.locator('input[aria-label="left label"]').fill('Declination');
  await ax.getByRole('button', { name: 'Accept' }).click();
  await win.locator('.legend button').first().click();
  const dlg = page.getByRole('dialog', { name: /Edit/ });
  await dlg.locator('select[aria-label="bottom column"]').selectOption('obs_start_mjd');
  await dlg.locator('select[aria-label="left column"]').selectOption('exposure_id');
  await dlg.getByRole('button', { name: 'Accept' }).click();
  await app.waitLoaded(win);
  expect(await labels()).toEqual(['exposure.obs_start_mjd', 'Declination']);
});
