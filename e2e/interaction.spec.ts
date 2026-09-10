import { expect, test } from './helpers';

test('hovering a point shows a tooltip and the coordinate readout', async ({ app, page }) => {
  const win = await app.addChart('Scatter plot');
  await app.addSeries(win, { bottom: 'ra', left: 'dec' });
  await app.waitLoaded(win);
  const c = (await win.locator('canvas').first().boundingBox())!;
  await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.5);
  await page.mouse.move(c.x + c.width * 0.5 + 1, c.y + c.height * 0.5 + 1);
  await expect(win.locator('.window-status .coords')).toContainText(
    /exposure\.ra .+ · exposure\.dec .+/,
  );
  await expect(page.getByRole('tooltip')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('tooltip')).toContainText('night');
  await page.mouse.move(10, 400);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
});

test('reset axes restores the view after a zoom and Refresh re-fetches', async ({ app, page }) => {
  const win = await app.addChart('Scatter plot');
  await app.addSeries(win, { bottom: 'ra', left: 'dec' });
  await app.waitLoaded(win);
  const id = (await win.getAttribute('data-testid'))!.replace('window-', '');
  const extents = () => page.evaluate((i) => window.__ddv!.chart(i), id);
  const before = await extents();
  const c = (await win.locator('canvas').first().boundingBox())!;
  await page.mouse.move(c.x + c.width * 0.5, c.y + c.height * 0.5);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -600);
  await page.keyboard.up('Shift');
  await expect.poll(extents).not.toEqual(before);
  await win.getByRole('button', { name: 'reset axes' }).click();
  await expect.poll(extents).toEqual(before);
  const loads = () => app.sent.filter((m) => m.name === 'load columns').length;
  const beforeSync = loads();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(loads, { timeout: 30_000 }).toBeGreaterThanOrEqual(beforeSync + 2); // count + data
  await app.waitLoaded(win);
});

test('copy puts the selected exposures on the clipboard as (dayObs, seqNum) pairs', async ({
  app,
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const win = await app.addChart('Scatter plot');
  await app.addSeries(win, { bottom: 'ra', left: 'dec' });
  await app.waitLoaded(win);
  await app.dragOn(win, 0.45, 0.45, 0.5, 0.5);
  const n = (await app.state()).selected;
  expect(n).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.locator('.toolbar .notice')).toContainText(/Copied [\d,]+ exposures/);
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toMatch(/^\[\(2025\d{4}, \d+\)(,\(2025\d{4}, \d+\))*\]$/);
  expect(text.split('),(').length).toBe(n);
});

test('datetime and categorical columns plot with time and category axes', async ({ app, page }) => {
  const scatter = await app.addChart('Scatter plot');
  await app.addSeries(scatter, { bottom: 'obs_start', left: 'dec' });
  await app.waitLoaded(scatter);
  await expect(scatter.locator('canvas').first()).toBeVisible();
  const hist = await app.addChart('Histogram');
  await app.moveWindow(hist, 700, -20);
  await app.addSeries(hist, { bottom: 'physical_filter' });
  await app.waitLoaded(hist);
  const c = (await hist.locator('canvas').first().boundingBox())!;
  await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.6);
  await page.mouse.move(c.x + c.width * 0.3 + 1, c.y + c.height * 0.6);
  await expect(page.getByRole('tooltip')).toContainText(/LSST [ugrizy]-band/, { timeout: 5_000 });
  await hist.getByRole('button', { name: 'axes…' }).click();
  await page
    .getByRole('dialog', { name: 'Edit axes' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  await scatter.getByRole('button', { name: 'axes…' }).click();
  const ax = page.getByRole('dialog', { name: 'Edit axes' });
  await ax.locator('input[type=checkbox]').nth(1).check(); // MJD labels on the bottom axis
  await ax.getByRole('button', { name: 'Accept' }).click();
  const saved = await app.saveJson();
  expect((Object.values(saved.windows)[0] as any).state.series[0].fields['bottom,0'].name).toBe(
    'obs_start',
  );
});
