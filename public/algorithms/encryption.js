/**
 * AES-GCM Encryption module using Web Crypto API.
 * - PBKDF2 for key derivation (SHA-256, 100k iterations)
 * - AES-GCM 256-bit encryption with 12-byte IV
 * - Output format: [salt:16][iv:12][ciphertext+authTag]
 */

const PBKDF2_ITERATIONS = 100000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const KEY_LENGTH = 256; // bits

/**
 * Derive an AES-GCM key from a password using PBKDF2.
 */
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await self.crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return self.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data with AES-GCM using a password.
 * @param {Uint8Array} data - Data to encrypt
 * @param {string} password - Encryption password
 * @param {function} [onProgress] - Progress callback (0-1)
 * @returns {Promise<{encrypted: Uint8Array, stats: object}>}
 */
async function encrypt(data, password, onProgress) {
  const startTime = performance.now();

  if (!password || password.length === 0) {
    throw new Error('Encryption password cannot be empty');
  }

  if (onProgress) onProgress(0.1);

  // Generate random salt and IV
  const salt = self.crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = self.crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  if (onProgress) onProgress(0.2);

  // Derive key from password
  const key = await deriveKey(password, salt);

  if (onProgress) onProgress(0.4);

  // Encrypt with AES-GCM
  const ciphertext = await self.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    data
  );

  if (onProgress) onProgress(0.9);

  // Combine: [salt][iv][ciphertext+authTag]
  const encrypted = new Uint8Array(SALT_LENGTH + IV_LENGTH + ciphertext.byteLength);
  encrypted.set(salt, 0);
  encrypted.set(iv, SALT_LENGTH);
  encrypted.set(new Uint8Array(ciphertext), SALT_LENGTH + IV_LENGTH);

  const elapsed = performance.now() - startTime;
  if (onProgress) onProgress(1);

  return {
    encrypted,
    stats: {
      originalSize: data.length,
      encryptedSize: encrypted.length,
      time: elapsed.toFixed(2),
      method: 'AES-GCM-256 + PBKDF2'
    }
  };
}

/**
 * Decrypt data with AES-GCM using a password.
 * @param {Uint8Array} data - Encrypted data (salt + iv + ciphertext)
 * @param {string} password - Decryption password
 * @param {function} [onProgress] - Progress callback (0-1)
 * @returns {Promise<{decrypted: Uint8Array, stats: object}>}
 */
async function decrypt(data, password, onProgress) {
  const startTime = performance.now();

  if (!password || password.length === 0) {
    throw new Error('Decryption password cannot be empty');
  }

  if (data.length < SALT_LENGTH + IV_LENGTH + 16) {
    throw new Error('Invalid encrypted data: too short');
  }

  if (onProgress) onProgress(0.1);

  // Extract salt, IV, and ciphertext
  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = data.subarray(SALT_LENGTH + IV_LENGTH);

  if (onProgress) onProgress(0.2);

  // Derive key from password
  const key = await deriveKey(password, salt);

  if (onProgress) onProgress(0.4);

  // Decrypt with AES-GCM (will throw if password is wrong / data tampered)
  let plaintext;
  try {
    plaintext = await self.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext
    );
  } catch (e) {
    throw new Error('Decryption failed: wrong password or corrupted data');
  }

  if (onProgress) onProgress(0.9);

  const decrypted = new Uint8Array(plaintext);

  const elapsed = performance.now() - startTime;
  if (onProgress) onProgress(1);

  return {
    decrypted,
    stats: {
      encryptedSize: data.length,
      decryptedSize: decrypted.length,
      time: elapsed.toFixed(2),
      method: 'AES-GCM-256 + PBKDF2'
    }
  };
}

if (typeof self !== 'undefined' && typeof module === 'undefined') {
  self.Encryption = { encrypt, decrypt };
}
if (typeof module !== 'undefined') {
  module.exports = { encrypt, decrypt };
}
