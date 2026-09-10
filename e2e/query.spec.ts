import { expect, test } from './helpers';

test('a compound global query filters charts and survives reopening', async ({ app, page }) => {
  const win = await app.addChart('Scatter plot');
  await app.addSeries(win, { bottom: 'ra', left: 'dec' });
  await app.waitLoaded(win);
  await page.getByRole('button', { name: /Global query/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Global query' });
  await dlg.locator('select[aria-label=table]').selectOption('exposure');
  await dlg.locator('select[aria-label=column]').selectOption('dec');
  await dlg.getByRole('button', { name: '+ condition' }).click();
  await dlg.locator('input[aria-label="right value"]').last().fill('0');
  await dlg.locator('select[aria-label=column]').selectOption('ra');
  await dlg.getByRole('button', { name: '+ condition' }).click();
  const rows = dlg.locator('.qcondition');
  await rows.nth(1).locator('input[aria-label="left value"]').fill('100');
  await rows.nth(1).locator('select[aria-label="right operator"]').selectOption('le');
  await rows.nth(1).locator('input[aria-label="right value"]').fill('200');
  await expect(dlg.getByRole('button', { name: 'Accept' })).toBeDisabled();
  const picks = dlg.locator('input[aria-label="select condition"]');
  await picks.nth(0).check();
  await picks.nth(1).check();
  await dlg.getByRole('button', { name: 'AND', exact: true }).click();
  await dlg.getByRole('button', { name: 'Accept' }).click();
  await expect(win.getByTestId('chart-status')).not.toContainText('100,000 rows', {
    timeout: 60_000,
  });
  await expect(page.getByRole('button', { name: /Global query/ })).toHaveAttribute(
    'title',
    '(exposure.dec < 0 AND 100 < exposure.ra ≤ 200)',
  );
  await page.getByRole('button', { name: /Global query/ }).click();
  await expect(dlg.locator('.qcondition')).toHaveCount(2);
  await dlg.locator('.qcondition button.danger').first().click();
  await expect(dlg.locator('select[aria-label="group operator"]')).toHaveCount(0); // group collapsed
  await dlg.getByRole('button', { name: 'Cancel' }).click();
});
