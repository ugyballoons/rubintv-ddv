import { expect, test } from './helpers';

test('the focal plane colours detectors per exposure, plays, and follows the selection', async ({
  app,
  page,
}) => {
  const win = await app.addChart('Focal plane');
  await app.resizeWindow(win, 200, 250);
  await expect(win.locator('polygon')).toHaveCount(205);
  await win.getByRole('button', { name: /choose column/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Focal plane column' });
  await dlg.locator('select[aria-label="focal column"]').selectOption('psf_sigma_median');
  await dlg.getByRole('button', { name: 'Accept' }).click();
  await app.setNights('2025-11-01');
  const meta = win.locator('.window-toolbar .meta');
  await expect(meta).toContainText('600 exposures from night', { timeout: 60_000 });
  const distinct = await win
    .locator('polygon')
    .evaluateAll((els) => new Set(els.map((e) => e.getAttribute('fill'))).size);
  expect(distinct).toBeGreaterThan(20);
  await win.locator('[data-detector="94"] polygon').click();
  await expect(page.getByRole('button', { name: /^Detector/ })).toContainText('R22_S11');
  await win.locator('[data-testid=focal-plane]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: /^Detector/ })).toContainText('R22_S12');
  await win.getByRole('button', { name: 'play' }).click();
  await expect(win.locator('.chip').nth(2)).not.toContainText('1 / 600', { timeout: 5_000 });
  await win.getByRole('button', { name: 'pause' }).click();
  const bar = (await win.locator('.colorbar-bar').boundingBox())!;
  await page.mouse.click(bar.x + bar.width / 2, bar.y + bar.height / 2);
  await expect(win.locator('.colorbar-handle')).toHaveCount(3);
  // a selection elsewhere re-fetches the focal plane for those exposures
  const scatter = await app.addChart('Scatter plot');
  await app.moveWindow(scatter, 700, -20);
  await app.addSeries(scatter, { bottom: 'ra', left: 'dec' });
  await app.waitLoaded(scatter);
  await app.dragOn(scatter, 0.4, 0.4, 0.5, 0.5);
  await expect(meta).toContainText('exposures from selection', { timeout: 60_000 });
});
