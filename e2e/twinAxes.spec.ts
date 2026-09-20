import { test, expect } from './helpers';

/** The ECharts option of a chart window, via the dev hook. */
async function optionOf(app: Awaited<ReturnType<typeof windowId>>['app'], id: string) {
  return (await app.page.evaluate((i) => window.__ddv!.chart(i), id)) as {
    yAxes: { position?: string; name?: string; color?: string }[];
    series: { id?: string; yAxisIndex?: number; rows: number }[];
  };
}
async function windowId(app: import('./helpers').App, win: import('@playwright/test').Locator) {
  return { app, id: (await win.getAttribute('data-testid'))!.replace('window-', '') };
}

test('a series of a second quantity gets its own right-hand y axis', async ({ app, page }) => {
  const win = await app.addChart('Scatter plot');
  // dec is in degrees; obs_start_mjd has no unit, so it is a different quantity.
  await app.addSeries(win, { bottom: 'ra', left: 'dec' }, { name: 'dec', color: '#058b8c' });
  await app.waitLoaded(win, 1);
  await app.addSeries(
    win,
    { bottom: 'ra', left: 'obs_start_mjd' },
    { name: 'mjd', color: '#e6194b' },
  );
  await app.waitLoaded(win, 2);
  const { id } = await windowId(app, win);

  const opt = await optionOf(app, id);
  expect(opt.yAxes).toHaveLength(2);
  expect(opt.yAxes[0]).toMatchObject({ name: 'exposure.dec', color: '#058b8c' });
  expect(opt.yAxes[1]).toMatchObject({
    position: 'right',
    name: 'exposure.obs_start_mjd',
    color: '#e6194b',
  });
  const mjd = opt.series.find((s) => s.id?.endsWith('-2'))!;
  expect(mjd.yAxisIndex).toBe(1);
  await expect(win.locator('.legend button[title="Edit mjd (right axis)"]')).toBeVisible();
  // The left axis label stayed with the first series' column.
  await expect(win.getByTestId('axis-warning')).toHaveCount(0);

  // Selected points are marked against the axis of their series.
  await app.dragOn(win, 0.2, 0.2, 0.9, 0.9);
  expect((await app.state()).selected).toBeGreaterThan(0);
  const after = await optionOf(app, id);
  const left = after.series.find((s) => s.id === '__selected__')!;
  const right = after.series.find((s) => s.id === '__selected__1')!;
  expect(left.yAxisIndex).toBe(0);
  expect(right.yAxisIndex).toBe(1);
  // Both series plot the same exposures, so every selected id is marked once per axis.
  expect(left.rows).toBe((await app.state()).selected);
  expect(right.rows).toBe(left.rows);
  await page.screenshot({ path: process.env.E2E_SHOT ?? 'test-results/twin-axes.png' });

  // A third quantity has no axis of its own: it shares the left one and says so.
  await app.addSeries(win, { bottom: 'ra', left: 'seq_num' }, { name: 'seq' });
  await app.waitLoaded(win, 3);
  await expect(win.getByTestId('axis-warning')).toContainText('seq: no third y axis');
  expect((await optionOf(app, id)).series.find((s) => s.id?.endsWith('-3'))!.yAxisIndex).toBe(0);
});

test('box charts split cross axes the same way', async ({ app }) => {
  const win = await app.addChart('Box chart');
  await app.addSeries(win, { bottom: 'ra', left: 'dec' });
  await app.waitLoaded(win, 1);
  await app.addSeries(win, { bottom: 'ra', left: 'obs_start_mjd' });
  await app.waitLoaded(win, 2);
  const { id } = await windowId(app, win);
  const opt = await optionOf(app, id);
  expect(opt.yAxes).toHaveLength(2);
  expect(opt.yAxes[1].position).toBe('right');
  expect(opt.series.map((s) => s.yAxisIndex)).toEqual([0, 1]);
});

test('the x axis is shared: new series default to it and a different quantity is warned about', async ({
  app,
  page,
}) => {
  const win = await app.addChart('Scatter plot');
  await app.addSeries(win, { bottom: 'obs_start_mjd', left: 'dec' }, { name: 'first' });
  await app.waitLoaded(win, 1);

  // The new-series editor starts on the first series' x column.
  await win.getByRole('button', { name: '+ series' }).click();
  const dlg = page.getByRole('dialog', { name: 'New series' });
  await expect(dlg.locator('select[aria-label="bottom column"]')).toHaveValue('obs_start_mjd');
  await expect(dlg.getByTestId('shared-axis-warning')).toHaveCount(0);
  // Picking a different quantity warns live; a compatible one does not.
  await dlg.locator('select[aria-label="bottom column"]').selectOption('ra');
  await expect(dlg.getByTestId('shared-axis-warning')).toContainText(
    'Different quantity from first (obs_start_mjd)',
  );
  if (process.env.E2E_SHOT_EDITOR) await page.screenshot({ path: process.env.E2E_SHOT_EDITOR });
  await dlg.locator('input[aria-label="series name"]').fill('odd');
  await dlg.locator('select[aria-label="left column"]').selectOption('dec');
  await dlg.getByRole('button', { name: 'Accept' }).click();
  await app.waitLoaded(win, 2);

  // The chart still has one x axis, and the status line says who is on the wrong scale.
  const { id } = await windowId(app, win);
  const opt = await optionOf(app, id);
  expect(opt.yAxes).toHaveLength(1);
  await expect(win.getByTestId('axis-warning')).toContainText(
    "odd: bottom column is a different quantity from first's",
  );
});
