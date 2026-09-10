import { expect, test } from './helpers';

test('the calendar marks nights with exposures and applies single nights, ranges and sets', async ({
  app,
  page,
}) => {
  const win = await app.addChart('Scatter plot');
  await app.addSeries(win, { bottom: 'ra', left: 'dec' });
  await app.waitLoaded(win);
  await page.getByRole('button', { name: 'All nights' }).click();
  const dlg = page.getByRole('dialog', { name: 'Choose nights' });
  await expect(dlg.locator('.night-status')).toContainText(
    /30 nights with exposures · latest 2025-11-30/,
    { timeout: 30_000 },
  );
  await expect(dlg.locator('.night-day.has-data')).toHaveCount(30);
  await expect(dlg.getByRole('button', { name: '2025-11-03' })).toHaveAttribute(
    'title',
    /3,334 exposures/,
  );
  // single night by click
  await dlg.getByRole('button', { name: '2025-11-03' }).click();
  await expect(win.getByTestId('chart-status')).toContainText('3,334 rows');
  await expect(page.getByRole('button', { name: '2025-11-03' }).first()).toBeVisible();
  // range by shift-click → a day_obs condition in the global query
  await dlg.getByRole('button', { name: '2025-11-05' }).click({ modifiers: ['Shift'] });
  await expect(win.getByTestId('chart-status')).toContainText('10,002 rows');
  const range = app.sent.filter((m) => m.name === 'load columns').at(-1)!;
  expect(range.parameters!.day_obs).toBeNull();
  expect(range.parameters!.global_query).toMatchObject({
    field: { name: 'day_obs', schema: 'exposure' },
    leftValue: 20251103,
    rightValue: 20251105,
  });
  // set by cmd-click on a third night
  await dlg.getByRole('button', { name: '2025-11-10' }).click({ modifiers: ['Meta'] });
  await expect(page.getByRole('button', { name: /4 nights/ })).toBeVisible();
  await expect(win.getByTestId('chart-status')).toContainText('13,336 rows');
  // saved workspaces keep sets under an extra key; single nights stay in dayObs
  const saved = await app.saveJson();
  expect(saved.nights).toMatchObject({ kind: 'set' });
  expect(saved.dayObs).toBeUndefined();
  await dlg.getByRole('button', { name: 'Clear' }).click();
  await expect(win.getByTestId('chart-status')).toContainText('100,000 rows');
});

test('a night with no rows shows a message instead of an empty chart', async ({ app }) => {
  const win = await app.addChart('Scatter plot');
  await app.addSeries(win, { bottom: 'ra', left: 'dec' });
  await app.waitLoaded(win);
  await app.setNights('2024-01-01');
  await expect(win.locator('.centered-note')).toContainText(/No rows.*Nothing matches 2024-01-01/s);
  await expect(win.getByTestId('chart-status')).toContainText('0 rows');
});

test('histograms show the rows selected elsewhere as inner bars', async ({ app, page }) => {
  const scatter = await app.addChart('Scatter plot');
  const hist = await app.addChart('Histogram');
  await app.moveWindow(hist, 700, -20);
  await app.addSeries(scatter, { bottom: 'ra', left: 'dec' });
  await app.addSeries(hist, { bottom: 'ra' });
  await app.waitLoaded(scatter);
  await app.waitLoaded(hist);
  const id = (await hist.getAttribute('data-testid'))!.replace('window-', '');
  const selectedInBins = async () => {
    const info = (await page.evaluate((i) => window.__ddv!.chart(i), id)) as {
      series: { type: string; data: number[][] }[];
    };
    const custom = info.series.find((s) => s.type === 'custom')!;
    return custom.data.reduce((n, row) => n + (row[4] ?? 0), 0);
  };
  expect(await selectedInBins()).toBe(0);
  await app.dragOn(scatter, 0.3, 0.2, 0.5, 0.8);
  const selected = (await app.state()).selected;
  expect(selected).toBeGreaterThan(1000);
  await expect.poll(selectedInBins, { timeout: 10_000 }).toBe(selected);
});
