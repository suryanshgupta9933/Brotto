import { describe, it, expect } from 'vitest';
import {
  generateState,
  generateCodeVerifier,
  TokenManager,
} from '../auth.js';

describe('auth helpers', () => {
  describe('generateState', () => {
    it('should generate a random state string', () => {
      const state1 = generateState();
      const state2 = generateState();

      expect(state1).toBeTruthy();
      expect(state2).toBeTruthy();
      expect(state1).not.toBe(state2);
      expect(state1.length).toBe(64); // 32 bytes = 64 hex chars
    });
  });

  describe('generateCodeVerifier', () => {
    it('should generate a code verifier string', () => {
      const verifier = generateCodeVerifier();

      expect(verifier).toBeTruthy();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
    });
  });

  describe('TokenManager', () => {
    describe('parseJWT', () => {
      it('should parse a valid JWT payload', () => {
        // Create a simple JWT with payload { "sub": "123", "exp": 9999999999 }
        const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        const payload = btoa(JSON.stringify({ sub: '123', exp: 9999999999 }));
        const signature = 'fake';
        const token = `${header}.${payload}.${signature}`;

        const parsed = TokenManager.parseJWT(token);

        expect(parsed).toBeTruthy();
        expect(parsed?.sub).toBe('123');
        expect(parsed?.exp).toBe(9999999999);
      });

      it('should return null for invalid JWT', () => {
        expect(TokenManager.parseJWT('invalid')).toBeNull();
        expect(TokenManager.parseJWT('only.two')).toBeNull();
      });
    });

    describe('getTokenExpiration', () => {
      it('should extract expiration from JWT', () => {
        const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const payload = btoa(JSON.stringify({ sub: '123', exp }));
        const signature = 'fake';
        const token = `${header}.${payload}.${signature}`;

        const expiration = TokenManager.getTokenExpiration(token);

        expect(expiration).toBeTruthy();
        expect(expiration?.getTime()).toBeCloseTo(exp * 1000, -2);
      });

      it('should return null for JWT without exp', () => {
        const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        const payload = btoa(JSON.stringify({ sub: '123' }));
        const signature = 'fake';
        const token = `${header}.${payload}.${signature}`;

        expect(TokenManager.getTokenExpiration(token)).toBeNull();
      });
    });

    describe('isTokenExpired', () => {
      it('should return true for expired tokens', () => {
        const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        const exp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
        const payload = btoa(JSON.stringify({ sub: '123', exp }));
        const signature = 'fake';
        const token = `${header}.${payload}.${signature}`;

        expect(TokenManager.isTokenExpired(token)).toBe(true);
      });

      it('should return false for valid tokens', () => {
        const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
        const exp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
        const payload = btoa(JSON.stringify({ sub: '123', exp }));
        const signature = 'fake';
        const token = `${header}.${payload}.${signature}`;

        expect(TokenManager.isTokenExpired(token)).toBe(false);
      });
    });
  });
});
