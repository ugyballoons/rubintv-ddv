import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { createConnection } from 'node:net';

const WS_PORT = Number(process.env.E2E_WS_PORT ?? 9927);

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}

/** Skips every test when the synthetic broker is not running (see scripts/dev-stack.sh). */
export const test = base.extend<{ app: App }>({
  app: async ({ page }, provide) => {
    base.skip(!(await portOpen(WS_PORT)), `no broker on port ${WS_PORT}; run scripts/dev-stack.sh`);
    const app = new App(page);
    await app.open();
    await provide(app);
  },
});
export { expect };

export type WindowType =
  'Scatter plot' | 'Polar scatter plot' | 'Histogram' | 'Box chart' | 'Focal plane';

/** Page object for the DDV workspace. */
export class App {
  /** Every command the app sent to the broker since the page opened. */
  readonly sent: { name?: string; type?: string; parameters?: Record<string, any> }[] = [];

  constructor(readonly page: Page) {
    page.on('websocket', (ws) => {
      if (!ws.url().includes('/ws/client')) return;
      ws.on('framesent', (f) => {
        try {
          this.sent.push(JSON.parse(String(f.payload)));
        } catch {
          /* non-JSON frame */
        }
      });
    });
  }

  async open(instrument = 'testdb'): Promise<void> {
    await this.page.goto('./');
    await this.page
      .locator('[role=status][aria-label*="connection open"]')
      .waitFor({ timeout: 40_000 });
    await this.page.locator('select[aria-label="Instrument"]').selectOption(instrument);
    await this.page
      .locator('[role=status][aria-label*="instrument ready"]')
      .waitFor({ timeout: 90_000 });
  }

  get windows(): Locator {
    return this.page.locator('[data-testid^=window-]');
  }

  async addChart(type: WindowType): Promise<Locator> {
    const before = await this.windows.count();
    await this.page.getByRole('button', { name: /Add chart/ }).click();
    await this.page.getByRole('menuitem', { name: type, exact: true }).click();
    await expect(this.windows).toHaveCount(before + 1);
    return this.windows.nth(before);
  }

  /** Drag a window by its title bar. */
  async moveWindow(win: Locator, dx: number, dy: number): Promise<void> {
    const tb = (await win.locator('.window-title').boundingBox())!;
    await this.page.mouse.move(tb.x + 120, tb.y + 15);
    await this.page.mouse.down();
    await this.page.mouse.move(tb.x + 120 + dx, tb.y + 15 + dy, { steps: 8 });
    await this.page.mouse.up();
  }

  /** Resize a window from its bottom-right corner. */
  async resizeWindow(win: Locator, dw: number, dh: number): Promise<void> {
    const b = (await win.boundingBox())!;
    await this.page.mouse.move(b.x + b.width - 3, b.y + b.height - 3);
    await this.page.mouse.down();
    await this.page.mouse.move(b.x + b.width + dw, b.y + b.height + dh, { steps: 6 });
    await this.page.mouse.up();
  }

  /** Add a series through the editor; fields are column names per axis location. */
  async addSeries(
    win: Locator,
    fields: Partial<Record<'bottom' | 'left' | 'radial' | 'angular', string>>,
    options: { name?: string; color?: string; table?: string } = {},
  ): Promise<void> {
    await win.getByRole('button', { name: '+ series' }).click();
    const dlg = this.page.getByRole('dialog', { name: 'New series' });
    if (options.name) await dlg.locator('input[aria-label="series name"]').fill(options.name);
    for (const [axis, column] of Object.entries(fields)) {
      if (options.table)
        await dlg.locator(`select[aria-label="${axis} table"]`).selectOption(options.table);
      await dlg.locator(`select[aria-label="${axis} column"]`).selectOption(column);
    }
    if (options.color) await dlg.locator('input[aria-label="marker colour"]').fill(options.color);
    await dlg.getByRole('button', { name: 'Accept' }).click();
  }

  /** Wait until a window's status line reports row counts for every series. */
  async waitLoaded(win: Locator, series = 1): Promise<string> {
    const status = win.getByTestId('chart-status');
    await expect
      .poll(async () => ((await status.textContent()) ?? '').match(/rows/g)?.length ?? 0, {
        timeout: 90_000,
      })
      .toBe(series);
    await expect(status).not.toContainText('…');
    return (await status.textContent()) ?? '';
  }

  /** Rectangle drag on a chart canvas, fractions of its box. */
  async dragOn(win: Locator, x0: number, y0: number, x1: number, y1: number): Promise<void> {
    const c = (await win.locator('canvas').first().boundingBox())!;
    await this.page.mouse.move(c.x + c.width * x0, c.y + c.height * y0);
    await this.page.mouse.down();
    await this.page.mouse.move(c.x + c.width * x1, c.y + c.height * y1, { steps: 8 });
    await this.page.mouse.up();
  }

  async state(): Promise<{
    selected: number;
    preview: number | null;
    drillDown: number | null;
    windows: { id: string; type: string; tool?: string; series?: number }[];
  }> {
    return this.page.evaluate(() => window.__ddv!.state() as never);
  }

  async saveJson(): Promise<Record<string, any>> {
    return JSON.parse(await this.page.evaluate(() => window.__ddv!.save()));
  }

  /** Type nights into the picker: "2025-11-03", "2025-11-01..2025-11-03", or "2025-11-01, 2025-11-03". */
  async setNights(text: string): Promise<void> {
    await this.page.getByRole('button', { name: /All nights|^\d{4}-\d{2}-\d{2}|nights$/ }).click();
    const dlg = this.page.getByRole('dialog', { name: 'Choose nights' });
    await dlg.locator('input[aria-label="night text"]').fill(text);
    await dlg.locator('input[aria-label="night text"]').press('Enter');
    await this.page.keyboard.press('Escape');
  }

  selectionButton(): Locator {
    return this.page.getByRole('button', { name: /Clear selection/ });
  }
}

declare global {
  interface Window {
    __ddv?: {
      save(): string;
      load(text: string): Promise<unknown>;
      state(): unknown;
      chart(id: string): unknown;
    };
  }
}
