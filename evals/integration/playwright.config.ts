import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Chromium on Linux
    {
      name: 'chromium-linux',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 1920, height: 1080 },
      },
    },

    // Chromium on macOS ARM64
    {
      name: 'chromium-macos-arm64',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        platform: 'macos',
        viewport: { width: 1920, height: 1080 },
      },
    },

    // Chromium on Windows
    {
      name: 'chromium-windows',
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        platform: 'windows',
        viewport: { width: 1920, height: 1080 },
      },
    },

    // Chrome stable on macOS
    {
      name: 'chrome-stable-macos',
      use: {
        browserName: 'chromium',
        channel: 'chrome-stable',
        viewport: { width: 1920, height: 1080 },
      },
    },

    // Edge stable on Windows
    {
      name: 'edge-stable-windows',
      use: {
        browserName: 'chromium',
        channel: 'msedge-stable',
        platform: 'windows',
        viewport: { width: 1920, height: 1080 },
      },
    },

    // Mobile emulation - iPad
    {
      name: 'mobile-ipad',
      use: {
        ...devices['iPad (gen 7)'],
      },
    },

    // Mobile emulation - iPhone
    {
      name: 'mobile-iphone',
      use: {
        ...devices['iPhone 13'],
      },
    },
  ],

  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
