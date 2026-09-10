import { expect, test } from './helpers';

test('windows can be added, moved, resized and closed', async ({ app }) => {
  const scatter = await app.addChart('Scatter plot');
  const hist = await app.addChart('Histogram');
  await app.moveWindow(hist, 700, -20);
  await app.resizeWindow(hist, 100, 60);
  const after = await app.saveJson();
  const [w1, w2] = Object.values(after.windows) as any[];
  expect(w1.state.windowType).toBe('cartesianScatter');
  expect(w2.state.windowType).toBe('histogram');
  expect(w2.offset.dx).toBeGreaterThan(w1.offset.dx + 600);
  expect(w2.size.width).toBeGreaterThan(650);
  await scatter.getByRole('button', { name: /close Scatter plot/ }).click();
  await expect(app.windows).toHaveCount(1);
});

test('a workspace saves and reloads identically, including the night filter', async ({
  app,
  page,
}) => {
  const scatter = await app.addChart('Scatter plot');
  await app.addSeries(scatter, { bottom: 'ra', left: 'dec' });
  await app.waitLoaded(scatter);
  await app.setNights('2025-11-03');
  await expect(scatter.getByTestId('chart-status')).toContainText('3,334 rows');
  const saved = await app.saveJson();
  expect(saved.dayObs).toBe('2025-11-03T00:00:00.000');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Clear workspace' }).click();
  await expect(app.windows).toHaveCount(0);
  await page.evaluate((text) => window.__ddv!.load(text), JSON.stringify(saved));
  await expect(app.windows).toHaveCount(1);
  await expect(app.windows.first().getByTestId('chart-status')).toContainText('3,334 rows');
  const again = await app.saveJson();
  const strip = (ws: any) =>
    Object.values(ws.windows).map((w: any) => [
      w.offset,
      w.size,
      w.state.series.map((s: any) => [s.id, s.fields]),
      w.state.axisInfo,
    ]);
  expect(strip(again)).toEqual(strip(saved));
});
