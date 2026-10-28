// Main game (index.html) checks. Each test title starts with its check id from tests/checks.json.
import { test, expect } from '@playwright/test';

test('[m1.page.boots-clean] the main game page loads to its menu with no page errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto('/index.html');
  await expect(page.locator('#btn-practice-mode')).toBeVisible();
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
