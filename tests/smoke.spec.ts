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
      form: Boolean(form),
      email: Boolean(email),
      button: Boolean(button),
    };
  });

  await expect(page.getByRole('heading', { name: siteConfig.brandName })).toBeVisible();
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
