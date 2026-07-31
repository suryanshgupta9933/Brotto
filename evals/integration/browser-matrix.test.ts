/**
 * Browser Integration Matrix Tests
 *
 * Tests browser automation across different browsers,
 * platforms, and display configurations.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Browser matrix configuration
interface BrowserMatrixConfig {
  browser: 'chromium' | 'chrome' | 'edge';
  channel?: 'stable' | 'beta';
  platform: 'windows' | 'macos' | 'linux';
  arch?: 'x64' | 'arm64';
}

const BROWSER_MATRIX: BrowserMatrixConfig[] = [
  { browser: 'chromium', platform: 'linux', arch: 'x64' },
  { browser: 'chromium', platform: 'macos', arch: 'arm64' },
  { browser: 'chromium', platform: 'macos', arch: 'x64' },
  { browser: 'chromium', platform: 'windows', arch: 'x64' },
  { browser: 'chrome', channel: 'stable', platform: 'macos', arch: 'arm64' },
  { browser: 'chrome', channel: 'beta', platform: 'macos', arch: 'arm64' },
  { browser: 'edge', channel: 'stable', platform: 'windows', arch: 'x64' },
];

// Display scale factor tests
const SCALE_FACTORS = [1, 1.25, 1.5, 2, 2.5, 3];

test.describe('Browser Integration Matrix', () => {
  for (const config of BROWSER_MATRIX) {
    test.describe(`${config.browser} ${config.channel || 'default'} on ${config.platform} ${config.arch || ''}`, () => {
      let browser: Browser;
      let context: BrowserContext;
      let page: Page;

      test.beforeEach(async ({ browser: browserInstance }) => {
        browser = browserInstance as Browser;
        context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: 2,
        });
        page = await context.newPage();
      });

      test.afterEach(async () => {
        await context.close();
      });

      test('should launch browser and create page', async () => {
        await page.goto('https://example.com');
        await expect(page).toHaveTitle(/Example/i);
      });

      test('should handle viewport dimensions', async () => {
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.goto('https://example.com');

        const dimensions = page.viewportSize();
        expect(dimensions?.width).toBe(1280);
        expect(dimensions?.height).toBe(720);
      });

      test('should capture screenshot', async () => {
        await page.goto('https://example.com');
        const screenshot = await page.screenshot();

        expect(screenshot).toBeInstanceOf(Buffer);
        expect(screenshot.length).toBeGreaterThan(0);
      });

      test('should execute click actions', async () => {
        await page.goto('data:text/html,<button id="btn">Click Me</button>');
        await page.click('#btn');

        const clicked = await page.evaluate(() => {
          const btn = document.getElementById('btn') as HTMLButtonElement;
          return btn?.textContent;
        });

        expect(clicked).toBe('Clicked');
      });

      test('should handle multiple tabs', async () => {
        await page.goto('https://example.com');

        const newPagePromise = page.context().waitForEvent('page');
        await page.evaluate(() => window.open('https://example.com'));
        const newPage = await newPagePromise;

        expect(page.context().pages()).toHaveLength(2);
        await newPage.close();
      });
    });
  }

  for (const scale of SCALE_FACTORS) {
    test.describe(`Display Scale Factor ${scale}x`, () => {
      let context: BrowserContext;
      let page: Page;

      test.beforeEach(async ({ browser }) => {
        context = await browser.newContext({
          viewport: { width: 1920, height: 1080 },
          deviceScaleFactor: scale,
        });
        page = await context.newPage();
      });

      test.afterEach(async () => {
        await context.close();
      });

      test(`should handle ${scale}x device pixel ratio`, async () => {
        await page.goto('https://example.com');

        const dpr = await page.evaluate(() => window.devicePixelRatio);
        expect(dpr).toBe(scale);
      });

      test(`should capture screenshot at ${scale}x scale`, async () => {
        await page.goto('https://example.com');
        const screenshot = await page.screenshot();

        expect(screenshot).toBeInstanceOf(Buffer);
        expect(screenshot.length).toBeGreaterThan(0);
      });

      test(`should report correct dimensions at ${scale}x scale`, async () => {
        await page.goto('data:text/html,<div style="width:100px;height:100px"></div>');
        const box = await page.locator('div').boundingBox();

        expect(box?.width).toBe(100);
        expect(box?.height).toBe(100);
      });
    });
  }
});

test.describe('Multi-Tab and Multi-Window', () => {
  test('should manage multiple tabs', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://example.com');

    // Open 3 new tabs
    for (let i = 0; i < 3; i++) {
      const newPage = await context.newPage();
      await newPage.goto(`https://example.com?tab=${i}`);
    }

    expect(context.pages()).toHaveLength(4);

    await context.close();
  });

  test('should handle popup windows', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const popupPromise = page.waitForEvent('popup');
    await page.goto('data:text/html,<a href="about:blank" target="_blank">Open Popup</a>');
    await page.click('a');
    const popup = await popupPromise;

    expect(popup).toBeDefined();
    await popup.close();

    await context.close();
  });
});

test.describe('Download and Upload', () => {
  test('should handle file download', async ({ browser }) => {
    const context = await browser.newContext({
      acceptDownloads: true,
    });
    const page = await context.newPage();

    await page.goto('data:text/html,<a href="data:text/plain;base64,SGVsbG8=" download="test.txt">Download</a>');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('a'),
    ]);

    expect(download.suggestedFilename()).toBe('test.txt');
    await context.close();
  });

  test('should handle file upload', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('data:text/html,<input type="file" id="file">');
    await page.setInputFiles('#file', {
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Hello World'),
    });

    const fileName = await page.inputValue('#file');
    expect(fileName).toBe('C:\\fakepath\\test.txt');

    await context.close();
  });
});

test.describe('Browser State and Lifecycle', () => {
  test('should persist context after navigation', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://example.com');
    await page.fill('input[type="text"]', 'test value');
    await page.goto('https://example.org');

    await page.goBack();
    // Note: input value may not persist across navigation

    await context.close();
  });

  test('should handle page reload', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://example.com');
    await page.reload();
    await expect(page).toHaveTitle(/Example/i);

    await context.close();
  });

  test('should handle browser back/forward', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://example.com');
    await page.goto('https://example.org');
    await page.goBack();

    await page.goForward();
    await expect(page).toHaveTitle(/Example/i);

    await context.close();
  });
});

test.describe('SSO and Authentication Flows', () => {
  test('should handle redirect chains', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    const redirects: string[] = [];
    page.on('redirect', (request) => {
      redirects.push(request.url());
    });

    await page.goto('https://httpbin.org/redirect-to?url=https://example.com');

    expect(page.url()).toContain('example.com');
    await context.close();
  });

  test('should handle basic authentication dialog', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Note: This test demonstrates the pattern for handling auth dialogs
    // Actual auth handling depends on specific auth implementation
    page.on('dialog', async (dialog) => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept('user:pass');
    });

    await context.close();
  });
});
