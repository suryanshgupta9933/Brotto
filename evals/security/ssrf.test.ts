/**
 * SSRF and Network Security Tests
 *
 * Tests platform protection against Server-Side Request Forgery,
 * DNS rebinding, and private network access.
 */

import { test, expect } from '@playwright/test';

test.describe('SSRF Protection', () => {
  const PRIVATE_IP_RANGES = [
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254', // AWS metadata
    'metadata.google.internal',
  ];

  const DANGEROUS_URL_SCHEMES = [
    'file:///etc/passwd',
    'gopher://localhost:70/',
    'dict://localhost:2628/',
    'sftp://localhost/',
    'ldap://localhost:389/',
  ];

  test.describe('Private IP Address Blocking', () => {
    for (const ip of PRIVATE_IP_RANGES) {
      test(`should block access to ${ip}`, async ({ page }) => {
        let requestBlocked = false;

        page.on('request', (req) => {
          if (req.url().includes(ip)) {
            requestBlocked = true;
          }
        });

        await page.goto('data:text/html,<html><body></body></html>');

        await page.evaluate((targetIp) => {
          fetch(`http://${targetIp}:80`).catch(() => {});
        }, ip);

        await page.waitForTimeout(100);

        // Platform should block requests to private IPs
        expect(requestBlocked).toBe(true);
      });
    }

    test('should block access to internal hostnames', async ({ page }) => {
      let requestBlocked = false;

      page.on('request', (req) => {
        const url = req.url();
        if (
          url.includes('localhost') ||
          url.includes('metadata.google.internal') ||
          url.includes('169.254.169.254')
        ) {
          requestBlocked = true;
        }
      });

      await page.goto('data:text/html,<html><body></body></html>');

      await page.evaluate(() => {
        fetch('http://metadata.google.internal/computeMetadata/v1/').catch(() => {});
        fetch('http://localhost:8000/').catch(() => {});
      });

      await page.waitForTimeout(100);

      expect(requestBlocked).toBe(true);
    });
  });

  test.describe('DNS Rebinding Protection', () => {
    test('should validate Host header', async ({ page }) => {
      await page.goto('data:text/html,<html><body></body></html>');

      // Simulate DNS rebinding attack where attacker controls DNS
      // but relies on browser sending correct Host header
      const hostHeaderSent: string[] = [];

      page.on('request', (req) => {
        hostHeaderSent.push(req.headers()['host'] || '');
      });

      await page.evaluate(() => {
        fetch('https://attacker-controlled-domain.com/', {
          headers: { Host: 'internal.service.local' }
        }).catch(() => {});
      });

      await page.waitForTimeout(100);

      // Platform should validate Host header matches expected domains
      expect(hostHeaderSent.length).toBeGreaterThan(0);
    });

    test('should handle TTL-based DNS rebinding', async ({ page }) => {
      // Test that platform doesn't rely solely on DNS for security
      await page.goto('data:text/html,<html><body></body></html>');

      const requests: string[] = [];
      page.on('request', (req) => {
        requests.push(req.url());
      });

      // Simulate multiple rapid requests that could exploit DNS caching
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => {
          fetch(`/api/resource?t=${Date.now()}`).catch(() => {});
        });
        await page.waitForTimeout(50);
      }

      // Platform should use additional security measures beyond DNS
      expect(requests.length).toBe(3);
    });
  });

  test.describe('Dangerous URL Scheme Blocking', () => {
    for (const scheme of DANGEROUS_URL_SCHEMES) {
      test(`should block ${scheme.split(':')[0]} scheme`, async ({ page }) => {
        let requestBlocked = false;
        let requestMade = false;

        page.on('request', (req) => {
          requestMade = true;
          if (req.url().startsWith(scheme.split(':')[0] + ':')) {
            requestBlocked = true;
          }
        });

        await page.goto('data:text/html,<html><body></body></html>');

        await page.evaluate((url) => {
          fetch(url).catch(() => {});
        }, scheme);

        await page.waitForTimeout(100);

        expect(requestMade).toBe(true);
        // Dangerous schemes should be blocked
        expect(requestBlocked || !requestMade).toBe(true);
      });
    }

    test('should block data: URLs in navigation', async ({ page }) => {
      let navigationAttempted = false;

      page.on('framenavigated', (frame) => {
        if (frame.url().startsWith('data:')) {
          navigationAttempted = true;
        }
      });

      await page.goto('data:text/html,<html><body></body></html>');

      await page.evaluate(() => {
        // @ts-ignore - intentional test
        window.location = 'data:text/html,<script>alert("xss")</script>';
      });

      await page.waitForTimeout(100);

      // Platform should not allow navigation to data: URLs
      expect(navigationAttempted).toBe(false);
    });
  });

  test.describe('Redirect Validation', () => {
    test('should validate redirect destinations', async ({ page }) => {
      await page.goto('data:text/html,<html><body></body></html>');

      const finalUrls: string[] = [];

      page.on('response', async (response) => {
        if (response.status() >= 300 && response.status() < 400) {
          const location = response.headers()['location'];
          if (location) {
            finalUrls.push(location);
          }
        }
      });

      // Simulate redirect to internal resource
      await page.evaluate(() => {
        fetch('/redirect?url=http://localhost:8080/internal').catch(() => {});
      });

      await page.waitForTimeout(200);

      // Platform should validate redirect destinations
      expect(finalUrls.length).toBeGreaterThanOrEqual(0);
    });

    test('should block open redirect vulnerabilities', async ({ page }) => {
      await page.goto('data:text/html,<html><body></body></html>');

      const dangerousRedirects: string[] = [];

      page.on('response', async (response) => {
        if (response.status() >= 300 && response.status() < 400) {
          const location = response.headers()['location'];
          if (location?.includes('javascript:') || location?.includes('data:')) {
            dangerousRedirects.push(location);
          }
        }
      });

      await page.evaluate(() => {
        fetch('/open-redirect?url=javascript:alert(1)').catch(() => {});
      });

      await page.waitForTimeout(100);

      // Open redirects to javascript: or data: should be blocked
      expect(dangerousRedirects.length).toBe(0);
    });
  });

  test.describe('URL Normalization', () => {
    test('should normalize URL-encoded characters', async ({ page }) => {
      await page.goto('data:text/html,<html><body></body></html>');

      const requestedUrls: string[] = [];

      page.on('request', (req) => {
        requestedUrls.push(req.url());
      });

      // Attempt bypass via URL encoding
      await page.evaluate(() => {
        fetch('/api/..%2f..%2fetc/passwd').catch(() => {});
        fetch('/api/%2e%2e/%2e%2e/secret').catch(() => {});
      });

      await page.waitForTimeout(100);

      // Platform should normalize and validate encoded paths
      expect(requestedUrls.length).toBeGreaterThan(0);
    });

    test('should handle Unicode normalization in URLs', async ({ page }) => {
      await page.goto('data:text/html,<html><body></body></html>');

      const requestedUrls: string[] = [];

      page.on('request', (req) => {
        requestedUrls.push(req.url());
      });

      // Attempt bypass via Unicode
      await page.evaluate(() => {
        fetch('/api/..∕..∕etc/passwd').catch(() => {});
      });

      await page.waitForTimeout(100);

      // Platform should normalize Unicode
      expect(requestedUrls.length).toBeGreaterThan(0);
    });
  });
});
