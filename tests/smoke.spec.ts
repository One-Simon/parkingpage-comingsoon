import { expect, test } from '@playwright/test';
import { siteConfig } from '../src/brand/siteConfig.ts';

test('production page spawns the canvas, overlay, and waitlist', async ({ page }) => {
  const consoleIssues: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      const text = msg.text();
      if (!text.includes('GPU stall due to ReadPixels')) {
        consoleIssues.push(`${msg.type()}: ${text}`);
      }
    }
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.mouse.move(120, 120);
  await page.mouse.move(720, 450, { steps: 10 });
  await page.mouse.move(1200, 760, { steps: 10 });

  const state = await page.evaluate(() => {
    const canvas = document.querySelector('#pixi-root canvas');
    const root = document.querySelector('#pixi-root');
    const form = document.querySelector('form');
    const email = document.querySelector('input[type="email"]');
    const button = document.querySelector('button');
    const panel = document.querySelector('.glass-card');
    const heading = document.querySelector('#hero-heading');
    const scrims = document.querySelectorAll('.scrim');
    const canvasRect = canvas?.getBoundingClientRect();
    const rootRect = root?.getBoundingClientRect();

    return {
      title: document.title,
      root: rootRect && { width: rootRect.width, height: rootRect.height },
      canvas: canvasRect && { width: canvasRect.width, height: canvasRect.height },
      backing: canvas instanceof HTMLCanvasElement && {
        width: canvas.width,
        height: canvas.height,
      },
      panelExists: Boolean(panel),
      panelHidden: panel?.hasAttribute('hidden') ?? false,
      headingText: heading?.textContent,
      hiddenScrims: Array.from(scrims).filter((scrim) => scrim.hasAttribute('hidden')).length,
      scrims: scrims.length,
      form: Boolean(form),
      email: Boolean(email),
      button: Boolean(button),
    };
  });

  expect(state.panelExists).toBe(true);
  expect(state.panelHidden).toBe(!siteConfig.ui.showPanel);
  expect(state.headingText).toBe(siteConfig.brandName);
  expect(state.hiddenScrims).toBe(siteConfig.ui.showPanel ? 0 : state.scrims);
  if (siteConfig.ui.showPanel) {
    await expect(page.getByRole('heading', { name: siteConfig.brandName })).toBeVisible();
  } else {
    await expect(page.locator('.glass-card')).toBeHidden();
  }
  expect(state.root?.width).toBeGreaterThan(300);
  expect(state.root?.height).toBeGreaterThan(300);
  expect(state.canvas?.width).toBeGreaterThan(300);
  expect(state.canvas?.height).toBeGreaterThan(300);
  expect(state.backing && state.backing.width).toBeGreaterThan(300);
  expect(state.backing && state.backing.height).toBeGreaterThan(300);
  expect(state.form).toBe(true);
  expect(state.email).toBe(true);
  expect(state.button).toBe(true);
  expect(consoleIssues).toEqual([]);
  expect(pageErrors).toEqual([]);
});
