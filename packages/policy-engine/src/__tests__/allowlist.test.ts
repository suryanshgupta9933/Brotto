/**
 * Tests for Domain Allowlist Evaluator
 */

import {
  DomainAllowlistEvaluator,
  evaluateDomain,
  DomainAllowlistConfig,
} from '../allowlist.js';

describe('DomainAllowlistEvaluator', () => {
  let evaluator: DomainAllowlistEvaluator;

  beforeEach(() => {
    evaluator = new DomainAllowlistEvaluator({
      allowlist: [],
      blocklist: [],
      defaultAllow: false,
      blockPrivateIPs: true,
      blockLocalhost: true,
      blockCloudMetadata: true,
    });
  });

  describe('evaluate', () => {
    describe('allowlist matching', () => {
      it('should allow exact domain matches', () => {
        evaluator.addToAllowlist('example.com');
        const result = evaluator.evaluate('example.com');
        expect(result.allowed).toBe(true);
        expect(result.matchType).toBe('exact');
        expect(result.source).toBe('allowlist');
      });

      it('should allow subdomain matches', () => {
        evaluator.addToAllowlist('example.com');
        const result = evaluator.evaluate('sub.example.com');
        expect(result.allowed).toBe(true);
        expect(result.matchType).toBe('subdomain');
      });

      it('should allow nested subdomain matches', () => {
        evaluator.addToAllowlist('example.com');
        const result = evaluator.evaluate('deep.nested.example.com');
        expect(result.allowed).toBe(true);
        expect(result.matchType).toBe('subdomain');
      });

      it('should allow wildcard patterns', () => {
        evaluator.addToAllowlist('*.example.com');
        const result = evaluator.evaluate('sub.example.com');
        expect(result.allowed).toBe(true);
        expect(result.matchType).toBe('pattern');
      });

      it('should allow regex patterns', () => {
        evaluator.addToAllowlist('/^.*\\.example\\.com$/');
        const result = evaluator.evaluate('anything.example.com');
        expect(result.allowed).toBe(true);
      });
    });

    describe('blocklist matching', () => {
      it('should block domains in blocklist', () => {
        evaluator.addToBlocklist('malicious.com');
        const result = evaluator.evaluate('malicious.com');
        expect(result.allowed).toBe(false);
        expect(result.source).toBe('blocklist');
      });

      it('should block subdomains of blocklisted domains', () => {
        evaluator.addToBlocklist('evil.com');
        const result = evaluator.evaluate('sub.evil.com');
        expect(result.allowed).toBe(false);
      });

      it('should blocklist take precedence over allowlist', () => {
        evaluator.addToAllowlist('example.com');
        evaluator.addToBlocklist('example.com');
        const result = evaluator.evaluate('example.com');
        expect(result.allowed).toBe(false);
        expect(result.source).toBe('blocklist');
      });
    });

    describe('private IP blocking', () => {
      it('should block loopback addresses', () => {
        evaluator = new DomainAllowlistEvaluator({ blockPrivateIPs: true });
        expect(evaluator.evaluate('127.0.0.1').allowed).toBe(false);
        expect(evaluator.evaluate('127.0.0.2').allowed).toBe(false);
      });

      it('should block private IP ranges', () => {
        evaluator = new DomainAllowlistEvaluator({ blockPrivateIPs: true });
        expect(evaluator.evaluate('10.0.0.1').allowed).toBe(false);
        expect(evaluator.evaluate('172.16.0.1').allowed).toBe(false);
        expect(evaluator.evaluate('192.168.1.1').allowed).toBe(false);
      });

      it('should block link-local addresses', () => {
        evaluator = new DomainAllowlistEvaluator({ blockPrivateIPs: true });
        expect(evaluator.evaluate('169.254.169.254').allowed).toBe(false);
      });

      it('should allow public IPs when blockPrivateIPs is false', () => {
        evaluator = new DomainAllowlistEvaluator({
          blockPrivateIPs: false,
          allowlist: [{ pattern: '8.8.8.8' }],
          defaultAllow: false
        });
        expect(evaluator.evaluate('8.8.8.8').allowed).toBe(true);
      });
    });

    describe('localhost blocking', () => {
      it('should block localhost by default', () => {
        expect(evaluator.evaluate('localhost').allowed).toBe(false);
        expect(evaluator.evaluate('127.0.0.1').allowed).toBe(false);
      });

      it('should allow localhost when blockLocalhost is false', () => {
        evaluator = new DomainAllowlistEvaluator({
          blockLocalhost: false,
          allowlist: [{ pattern: 'localhost' }],
          defaultAllow: false
        });
        expect(evaluator.evaluate('localhost').allowed).toBe(true);
      });
    });

    describe('cloud metadata blocking', () => {
      it('should block AWS metadata endpoint', () => {
        expect(evaluator.evaluate('169.254.169.254').allowed).toBe(false);
      });

      it('should block GCP metadata endpoint', () => {
        expect(evaluator.evaluate('metadata.google.internal').allowed).toBe(false);
      });

      it('should block Azure metadata endpoint', () => {
        expect(evaluator.evaluate('100.100.100.200').allowed).toBe(false);
      });
    });

    describe('dangerous scheme blocking', () => {
      it('should block javascript: URLs', () => {
        expect(evaluator.evaluate('javascript:alert(1)').allowed).toBe(false);
      });

      it('should block data: URLs', () => {
        expect(evaluator.evaluate('data:text/html,<script>alert(1)</script>').allowed).toBe(false);
      });

      it('should block file: URLs', () => {
        expect(evaluator.evaluate('file:///etc/passwd').allowed).toBe(false);
      });
    });

    describe('default behavior', () => {
      it('should deny by default', () => {
        evaluator = new DomainAllowlistEvaluator({ defaultAllow: false });
        expect(evaluator.evaluate('unknown.com').allowed).toBe(false);
        expect(evaluator.evaluate('unknown.com').source).toBe('default');
      });

      it('should allow by default when configured', () => {
        evaluator = new DomainAllowlistEvaluator({ defaultAllow: true });
        expect(evaluator.evaluate('unknown.com').allowed).toBe(true);
      });
    });
  });

  describe('host extraction', () => {
    it('should extract host from URL with scheme', () => {
      evaluator.addToAllowlist('example.com');
      expect(evaluator.evaluate('https://example.com/path').allowed).toBe(true);
    });

    it('should extract host from URL without scheme', () => {
      evaluator.addToAllowlist('example.com');
      expect(evaluator.evaluate('example.com/path/to/page').allowed).toBe(true);
    });

    it('should handle URLs starting with //', () => {
      evaluator.addToAllowlist('example.com');
      expect(evaluator.evaluate('//example.com/path').allowed).toBe(true);
    });
  });

  describe('batch evaluation', () => {
    it('should evaluate multiple domains', () => {
      evaluator.addToAllowlist('allowed.com');
      const results = evaluator.evaluateMany(['allowed.com', 'denied.com']);

      expect(results.get('allowed.com')?.allowed).toBe(true);
      expect(results.get('denied.com')?.allowed).toBe(false);
    });
  });

  describe('list management', () => {
    it('should add domains to allowlist', () => {
      evaluator.addToAllowlist('test.com', 'Test domain');
      expect(evaluator.evaluate('test.com').allowed).toBe(true);
    });

    it('should remove domains from allowlist', () => {
      evaluator.addToAllowlist('test.com');
      evaluator.removeFromAllowlist('test.com');
      expect(evaluator.evaluate('test.com').allowed).toBe(false);
    });

    it('should add domains to blocklist', () => {
      evaluator.addToBlocklist('blocked.com', 'Blocked domain');
      expect(evaluator.evaluate('blocked.com').allowed).toBe(false);
    });

    it('should remove domains from blocklist', () => {
      evaluator.addToBlocklist('blocked.com');
      evaluator.removeFromBlocklist('blocked.com');
      evaluator.addToAllowlist('blocked.com'); // Add to allowlist so it passes when not in blocklist
      expect(evaluator.evaluate('blocked.com').allowed).toBe(true);
    });

    it('should get current allowlist', () => {
      evaluator.addToAllowlist('a.com');
      evaluator.addToAllowlist('b.com');
      const allowlist = evaluator.getAllowlist();
      expect(allowlist).toHaveLength(2);
    });

    it('should get current blocklist', () => {
      evaluator.addToBlocklist('a.com');
      evaluator.addToBlocklist('b.com');
      const blocklist = evaluator.getBlocklist();
      expect(blocklist).toHaveLength(2);
    });
  });

  describe('expired entries', () => {
    it('should skip expired allowlist entries', () => {
      const expiredEvaluator = new DomainAllowlistEvaluator({
        allowlist: [
          {
            pattern: 'expired.com',
            expiresAt: new Date(Date.now() - 1000), // 1 second ago
          },
        ],
      });
      expect(expiredEvaluator.evaluate('expired.com').allowed).toBe(false);
    });

    it('should not skip non-expired entries', () => {
      const validEvaluator = new DomainAllowlistEvaluator({
        allowlist: [
          {
            pattern: 'valid.com',
            expiresAt: new Date(Date.now() + 10000), // 10 seconds from now
          },
        ],
      });
      expect(validEvaluator.evaluate('valid.com').allowed).toBe(true);
    });
  });
});

describe('evaluateDomain convenience function', () => {
  it('should use default evaluator', () => {
    // Default evaluator has defaultAllow: false
    const result = evaluateDomain('example.com');
    expect(result.allowed).toBe(false);
  });
});
