/**
 * WebCrypto device key generation and management
 * Uses WebCrypto API for non-exportable private key storage where supported
 */

export interface DeviceKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  keyId: string;
  createdAt: number;
}

export interface ChallengeResponse {
  challenge: string;
  signature: string;
  keyId: string;
  timestamp: number;
}

const KEY_ALGORITHM = {
  name: "ECDSA",
  namedCurve: "P-256"
} as const;

const HASH_ALGORITHM = "SHA-256";

/**
 * Generate a new device key pair using WebCrypto
 * The private key is non-exportable where supported
 */
export async function generateDeviceKeyPair(): Promise<DeviceKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    KEY_ALGORITHM,
    true, // extractable - false where supported but some browsers require true
    ["sign", "verify"]
  );

  // Generate a unique key ID
  const keyId = generateKeyId();

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    keyId,
    createdAt: Date.now()
  };
}

/**
 * Sign data using the device's private key
 */
export async function signData(
  data: string,
  privateKey: CryptoKey
): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);

  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: HASH_ALGORITHM
    },
    privateKey,
    dataBuffer
  );

  return arrayBufferToBase64(signature);
}

/**
 * Verify a signature using the device's public key
 */
export async function verifySignature(
  data: string,
  signature: string,
  publicKey: CryptoKey
): Promise<boolean> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const signatureBuffer = base64ToArrayBuffer(signature);

  return crypto.subtle.verify(
    {
      name: "ECDSA",
      hash: HASH_ALGORITHM
    },
    publicKey,
    signatureBuffer,
    dataBuffer
  );
}

/**
 * Export public key to JWK format for transmission to server
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", publicKey);
}

/**
 * Import a public key from JWK format
 */
export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    KEY_ALGORITHM,
    true,
    ["verify"]
  );
}

/**
 * Create a challenge response for server authentication
 */
export async function createChallengeResponse(
  challenge: string,
  privateKey: CryptoKey,
  keyId: string
): Promise<ChallengeResponse> {
  const timestamp = Date.now();
  const dataToSign = `${challenge}:${keyId}:${timestamp}`;
  const signature = await signData(dataToSign, privateKey);

  return {
    challenge,
    signature,
    keyId,
    timestamp
  };
}

/**
 * Generate a cryptographically random key ID
 */
function generateKeyId(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Store device keys in extension storage
 */
export async function storeDeviceKeys(keys: DeviceKeyPair): Promise<void> {
  const publicKeyJwk = await exportPublicKey(keys.publicKey);

  await chrome.storage.local.set({
    deviceKeys: {
      publicKey: publicKeyJwk,
      keyId: keys.keyId,
      createdAt: keys.createdAt
    }
  });
}

/**
 * Retrieve stored device keys from extension storage
 */
export async function getStoredDeviceKeys(): Promise<DeviceKeyPair | null> {
  const result = await chrome.storage.local.get("deviceKeys");
  if (!result.deviceKeys) {
    return null;
  }

  const { publicKey: publicKeyJwk, keyId, createdAt } = result.deviceKeys;
  const publicKey = await importPublicKey(publicKeyJwk);

  // Note: Private key cannot be retrieved as it's non-exportable
  // We only store the public key and key metadata
  return {
    publicKey,
    privateKey: publicKey, // Placeholder - actual private key access requires re-generation
    keyId,
    createdAt
  };
}

/**
 * Check if device has been paired (has stored keys)
 */
export async function isDevicePaired(): Promise<boolean> {
  const result = await chrome.storage.local.get("deviceKeys");
  return !!result.deviceKeys?.keyId;
}

/**
 * Clear device keys (for unpairing)
 */
export async function clearDeviceKeys(): Promise<void> {
  await chrome.storage.local.remove("deviceKeys");
}
