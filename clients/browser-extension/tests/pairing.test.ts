/**
 * Unit tests for device pairing flow
 */

// Mock chrome.storage
const mockStorage: Record<string, unknown> = {};
global.chrome = {
  storage: {
    local: {
      get: async (key: string) => {
        const result: Record<string, unknown> = {};
        if (typeof key === "string") {
          result[key] = mockStorage[key];
        } else if (Array.isArray(key)) {
          key.forEach((k) => {
            result[k] = mockStorage[k];
          });
        }
        return result;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(mockStorage, items);
      },
      remove: async (key: string) => {
        delete mockStorage[key];
      },
      clear: async () => {
        Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
      }
    }
  }
} as unknown as typeof chrome;

// Mock fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

import {
  initiatePairing,
  exchangePairingCode,
  authenticate,
  refreshTokens,
  getAccessToken,
  revokeAndClear,
  getPairingState,
  type PairingState
} from "../src/pairing";

describe("Device Pairing", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    mockFetch.mockReset();
  });

  describe("initiatePairing", () => {
    it("should create a pairing code and store it", async () => {
      const serverUrl = "https://api.fara1.5.example.com";
      const result = await initiatePairing(serverUrl);

      expect(result.pairingCode).toBeDefined();
      expect(result.pairingCode.length).toBe(8);
      expect(result.expiresAt).toBeGreaterThan(Date.now());

      // Verify stored
      const stored = await chrome.storage.local.get("pendingPairing");
      expect(stored.pendingPairing).toBeDefined();
      expect(stored.pendingPairing.serverUrl).toBe(serverUrl);
    });

    it("should generate 8-character alphanumeric codes", async () => {
      const result = await initiatePairing("https://api.example.com");

      // Should be uppercase letters and numbers only
      expect(result.pairingCode).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    });
  });

  describe("exchangePairingCode", () => {
    it("should exchange pairing code for device identity", async () => {
      const serverUrl = "https://api.fara1.5.example.com";
      const mockResponse = {
        deviceId: "device-123",
        expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      });

      // First initiate pairing
      await initiatePairing(serverUrl);

      const result = await exchangePairingCode(serverUrl, "TESTCODE");

      expect(result.deviceId).toBe(mockResponse.deviceId);
      expect(result.serverUrl).toBe(serverUrl);
      expect(mockFetch).toHaveBeenCalledWith(
        `${serverUrl}/api/v1/pairing/exchange`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: expect.stringContaining("TESTCODE")
        })
      );
    });

    it("should throw on server error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "Invalid pairing code"
      });

      await expect(
        exchangePairingCode("https://api.example.com", "INVALID")
      ).rejects.toThrow("Pairing exchange failed");
    });
  });

  describe("authenticate", () => {
    it("should authenticate and receive tokens", async () => {
      const serverUrl = "https://api.fara1.5.example.com";
      const mockChallenge = { challenge: "server-challenge" };
      const mockTokens = {
        accessToken: "access-token-123",
        refreshToken: "refresh-token-456",
        expiresIn: 3600,
        tokenType: "Bearer"
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockChallenge
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockTokens
        });

      // Store device identity first
      await chrome.storage.local.set({
        deviceIdentity: {
          deviceId: "device-123",
          keyId: "key-456",
          serverUrl
        }
      });

      const result = await authenticate(serverUrl, "device-123", "key-456");

      expect(result.accessToken).toBe(mockTokens.accessToken);
      expect(result.refreshToken).toBe(mockTokens.refreshToken);
      expect(result.expiresIn).toBe(3600);
    });

    it("should throw when no device keys found", async () => {
      // Don't store device keys
      await expect(
        authenticate("https://api.example.com", "device-123", "key-456")
      ).rejects.toThrow("Device keys not found");
    });
  });

  describe("getAccessToken", () => {
    it("should return null when no tokens stored", async () => {
      const token = await getAccessToken();
      expect(token).toBeNull();
    });

    it("should return stored access token", async () => {
      const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour from now
      await chrome.storage.local.set({
        authTokens: {
          accessToken: "stored-access-token",
          refreshToken: "stored-refresh-token",
          expiresAt,
          tokenType: "Bearer"
        }
      });

      const token = await getAccessToken();
      expect(token).toBe("stored-access-token");
    });

    it("should refresh token when about to expire", async () => {
      // Token expires in 30 seconds (less than threshold of 60 seconds)
      const expiresAt = Date.now() + 30 * 1000;
      const newTokens = {
        accessToken: "new-access-token",
        refreshToken: "new-refresh-token",
        expiresIn: 3600,
        tokenType: "Bearer"
      };

      await chrome.storage.local.set({
        deviceIdentity: {
          deviceId: "device-123",
          keyId: "key-456",
          serverUrl: "https://api.example.com"
        },
        authTokens: {
          accessToken: "old-access-token",
          refreshToken: "old-refresh-token",
          expiresAt,
          tokenType: "Bearer"
        }
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => newTokens
      });

      const token = await getAccessToken();
      expect(token).toBe("new-access-token");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.example.com/api/v1/auth/refresh",
        expect.any(Object)
      );
    });
  });

  describe("revokeAndClear", () => {
    it("should revoke tokens and clear storage", async () => {
      const serverUrl = "https://api.fara1.5.example.com";

      await chrome.storage.local.set({
        deviceIdentity: { deviceId: "device-123", keyId: "key-456", serverUrl },
        authTokens: { accessToken: "token", refreshToken: "refresh" }
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true })
      });

      await revokeAndClear();

      // Verify storage is cleared
      const stored = await chrome.storage.local.get([
        "deviceIdentity",
        "authTokens"
      ]);
      expect(stored.deviceIdentity).toBeUndefined();
      expect(stored.authTokens).toBeUndefined();

      // Verify revocation was called
      expect(mockFetch).toHaveBeenCalledWith(
        `${serverUrl}/api/v1/auth/revoke`,
        expect.any(Object)
      );
    });

    it("should clear storage even if server revocation fails", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await chrome.storage.local.set({
        deviceIdentity: {
          deviceId: "device-123",
          keyId: "key-456",
          serverUrl: "https://api.example.com"
        }
      });

      // Should not throw
      await expect(revokeAndClear()).resolves.not.toThrow();

      // Storage should still be cleared
      const stored = await chrome.storage.local.get("deviceIdentity");
      expect(stored.deviceIdentity).toBeUndefined();
    });
  });

  describe("getPairingState", () => {
    it("should return idle state when not paired", async () => {
      const state = await getPairingState();

      expect(state.status).toBe("idle");
      expect(state.serverUrl).toBeNull();
      expect(state.error).toBeNull();
    });

    it("should return paired state when device identity exists", async () => {
      await chrome.storage.local.set({
        deviceIdentity: {
          deviceId: "device-123",
          keyId: "key-456",
          serverUrl: "https://api.example.com"
        }
      });

      const state = await getPairingState();

      expect(state.status).toBe("paired");
      expect(state.serverUrl).toBe("https://api.example.com");
    });

    it("should return waiting_for_code when pairing is pending", async () => {
      await chrome.storage.local.set({
        pendingPairing: {
          code: "TESTCODE",
          serverUrl: "https://api.example.com",
          expiresAt: Date.now() + 5 * 60 * 1000
        }
      });

      const state = await getPairingState();

      expect(state.status).toBe("waiting_for_code");
      expect(state.serverUrl).toBe("https://api.example.com");
    });

    it("should return idle with error when pairing code expired", async () => {
      await chrome.storage.local.set({
        pendingPairing: {
          code: "TESTCODE",
          serverUrl: "https://api.example.com",
          expiresAt: Date.now() - 1000 // Expired
        }
      });

      const state = await getPairingState();

      expect(state.status).toBe("idle");
      expect(state.error).toBe("Pairing code expired");
    });
  });
});
