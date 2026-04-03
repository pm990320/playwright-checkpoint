import { test } from '../fixtures';

test('capture the Playwright homepage', async ({ page, checkpoint }) => {
  await page.goto('https://playwright.dev/', { waitUntil: 'domcontentloaded' });
  await checkpoint('Homepage');
});

test('capture a documented getting-started flow @user-journey', async ({ page, checkpoint }) => {
  await page.goto('https://playwright.dev/docs/intro', { waitUntil: 'domcontentloaded' });

  await checkpoint('Open the introduction guide', {
    step: 1,
    description: 'Open the Playwright introduction guide to review the install steps and first-test walkthrough.',
    highlightSelector: 'main h1',
  });
});

test('capture docs navigation with collector overrides', async ({ page, checkpoint }) => {
  await page.goto('https://playwright.dev/', { waitUntil: 'domcontentloaded' });

  await checkpoint('Docs navigation', {
    collectors: {
      axe: false,
      network: false,
      metadata: true,
    },
    highlightSelector: 'a[href="/docs/intro"]',
    fullPage: false,
  });
});
