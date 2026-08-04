/**
 * Unit tests for WebCrypto device key generation
 */

import {
  generateDeviceKeyPair,
  signData,
  verifySignature,
  exportPublicKey,
  importPublicKey,
  createChallengeResponse,
  storeDeviceKeys,
  getStoredDeviceKeys,
  isDevicePaired,
  clearDeviceKeys
} from "../src/crypto";

// Mock chrome.storage
const mockStorage: Record<string, unknown> = {};
global.chrome = {
  storage: {
    local: {
      get: async (key: string | string[]) => {
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

describe("WebCrypto Device Keys", () => {
  beforeEach(async () => {
    // Clear storage before each test
    await chrome.storage.local.clear();
  });

  describe("generateDeviceKeyPair", () => {
    it("should generate a valid ECDSA P-256 key pair", async () => {
      const keyPair = await generateDeviceKeyPair();

      expect(keyPair).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.keyId).toBeDefined();
      expect(keyPair.createdAt).toBeGreaterThan(0);
    });

    it("should generate unique key IDs", async () => {
      const keyPair1 = await generateDeviceKeyPair();
      const keyPair2 = await generateDeviceKeyPair();

      expect(keyPair1.keyId).not.toBe(keyPair2.keyId);
    });
  });

  describe("signData and verifySignature", () => {
    it("should sign and verify data correctly", async () => {
      const keyPair = await generateDeviceKeyPair();
      const data = "Test data to sign";

      const signature = await signData(data, keyPair.privateKey);
      expect(signature).toBeDefined();
      expect(typeof signature).toBe("string");

      const isValid = await verifySignature(
        data,
        signature,
        keyPair.publicKey
      );
      expect(isValid).toBe(true);
    });

    it("should reject invalid signatures", async () => {
      const keyPair = await generateDeviceKeyPair();
      const data = "Original data";
      const tamperedData = "Tampered data";

      const signature = await signData(data, keyPair.privateKey);
      const isValid = await verifySignature(
        tamperedData,
        signature,
        keyPair.publicKey
      );
      expect(isValid).toBe(false);
    });

    it("should produce different signatures for same data", async () => {
      const keyPair = await generateDeviceKeyPair();
      const data = "Test data";

      const signature1 = await signData(data, keyPair.privateKey);
      const signature2 = await signData(data, keyPair.privateKey);

      // ECDSA signatures are non-deterministic due to random k value
      expect(signature1).not.toBe(signature2);
    });
  });

  describe("exportPublicKey and importPublicKey", () => {
    it("should export and reimport a public key", async () => {
      const keyPair = await generateDeviceKeyPair();
      const exported = await exportPublicKey(keyPair.publicKey);

      expect(exported).toBeDefined();
      expect(exported.kty).toBe("EC");
      expect(exported.crv).toBe("P-256");

      const imported = await importPublicKey(exported);
      expect(imported).toBeDefined();
    });

    it("should verify signatures with reimported public key", async () => {
      const keyPair = await generateDeviceKeyPair();
      const exported = await exportPublicKey(keyPair.publicKey);
      const imported = await importPublicKey(exported);

      const data = "Test data";
      const signature = await signData(data, keyPair.privateKey);

      const isValid = await verifySignature(data, signature, imported);
      expect(isValid).toBe(true);
    });
  });

  describe("createChallengeResponse", () => {
    it("should create a valid challenge response", async () => {
      const keyPair = await generateDeviceKeyPair();
      const challenge = "server-challenge-string";

      const response = await createChallengeResponse(
        challenge,
        keyPair.privateKey,
        keyPair.keyId
      );

      expect(response).toBeDefined();
      expect(response.challenge).toBe(challenge);
      expect(response.keyId).toBe(keyPair.keyId);
      expect(response.signature).toBeDefined();
      expect(response.timestamp).toBeGreaterThan(0);
    });
  });

  describe("storeDeviceKeys and getStoredDeviceKeys", () => {
    it("should store and retrieve device keys", async () => {
      const keyPair = await generateDeviceKeyPair();
      await storeDeviceKeys(keyPair);

      const retrieved = await getStoredDeviceKeys();

      expect(retrieved).toBeDefined();
      expect(retrieved?.keyId).toBe(keyPair.keyId);
      expect(retrieved?.createdAt).toBe(keyPair.createdAt);
    });

    it("should return null when no keys stored", async () => {
      const result = await getStoredDeviceKeys();
      expect(result).toBeNull();
    });
  });

  describe("isDevicePaired", () => {
    it("should return false when no keys stored", async () => {
      const result = await isDevicePaired();
      expect(result).toBe(false);
    });

    it("should return true when keys are stored", async () => {
      const keyPair = await generateDeviceKeyPair();
      await storeDeviceKeys(keyPair);

      const result = await isDevicePaired();
      expect(result).toBe(true);
    });
  });

  describe("clearDeviceKeys", () => {
    it("should clear stored keys", async () => {
      const keyPair = await generateDeviceKeyPair();
      await storeDeviceKeys(keyPair);

      await clearDeviceKeys();

      const result = await getStoredDeviceKeys();
      expect(result).toBeNull();
    });
  });
});
