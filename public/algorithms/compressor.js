const MAGIC = [0x43, 0x4D, 0x50, 0x58]; // "CMPX"
const FORMAT_VERSION = 2; // Bumped for encryption support

const MODE = {
  HUFFMAN: 0,
  LZ77: 1,
  COMBINED: 2
};

/**
 * File format (v2):
 * [0-3]  Magic bytes "CMPX"
 * [4]    Format version (2)
 * [5]    Flags byte: bits 0-1 = compression mode, bit 2 = encrypted
 * [6-7]  Filename length (uint16 BE)
 * [8+]   Filename bytes
 * [...]  Compressed payload (optionally encrypted)
 */

function compress(data, filename, mode, onProgress) {
  const totalStart = performance.now();

  const compressProgress = (p) => { if (onProgress) onProgress(p * 0.9); };

  let result;
  let stats;

  switch (mode) {
    case MODE.HUFFMAN: {
      result = self.HuffmanCoding.encode(data, compressProgress);
      stats = result.stats;
      break;
    }
    case MODE.LZ77: {
      result = self.LZ77.encode(data, compressProgress);
      stats = result.stats;
      break;
    }
    case MODE.COMBINED: {
      const lz77Progress = (p) => { if (onProgress) onProgress(p * 0.45); };
      const lz77Result = self.LZ77.encode(data, lz77Progress);

      const huffProgress = (p) => { if (onProgress) onProgress(0.45 + p * 0.45); };
      const huffResult = self.HuffmanCoding.encode(lz77Result.compressed, huffProgress);

      result = { compressed: huffResult.compressed };
      stats = {
        originalSize: data.length,
        compressedSize: huffResult.compressed.length,
        ratio: ((1 - huffResult.compressed.length / data.length) * 100).toFixed(2),
        algorithm: 'combined',
        lz77IntermediateSize: lz77Result.compressed.length,
        lz77Ratio: lz77Result.stats.ratio,
        huffmanRatio: huffResult.stats.ratio,
        matchCount: lz77Result.stats.matchCount,
        literalCount: lz77Result.stats.literalCount,
        uniqueBytes: huffResult.stats.uniqueBytes,
        frequencyTable: huffResult.stats.frequencyTable
      };
      break;
    }
    default:
      throw new Error(`Unknown compression mode: ${mode}`);
  }

  const filenameBytes = new TextEncoder().encode(filename);
  // Flags: bits 0-1 = mode, bit 2 = encrypted (0 here, encryption handled separately)
  const flagsByte = mode & 0x03;
  const headerSize = 4 + 1 + 1 + 2 + filenameBytes.length;
  const output = new Uint8Array(headerSize + result.compressed.length);
  const view = new DataView(output.buffer);

  output.set(MAGIC, 0);
  output[4] = FORMAT_VERSION;
  output[5] = flagsByte;
  view.setUint16(6, filenameBytes.length, false);
  output.set(filenameBytes, 8);
  output.set(result.compressed, headerSize);

  const totalTime = performance.now() - totalStart;
  if (onProgress) onProgress(1);

  // Safeguard: if compression expanded the data, store raw bytes instead.
  // This is common for small files, already-compressed files (zip, png, jpg),
  // or high-entropy data. Uses mode 0x03 (STORED) in flags.
  if (output.length >= data.length) {
    const storedHeaderSize = 4 + 1 + 1 + 2 + filenameBytes.length;
    const stored = new Uint8Array(storedHeaderSize + data.length);
    const storedView = new DataView(stored.buffer);

    stored.set(MAGIC, 0);
    stored[4] = FORMAT_VERSION;
    stored[5] = 0x03; // Mode STORED (bits 0-1 = 0x03)
    storedView.setUint16(6, filenameBytes.length, false);
    stored.set(filenameBytes, 8);
    stored.set(data, storedHeaderSize);

    const storedStats = {
      ...stats,
      originalSize: data.length,
      compressedSize: stored.length,
      ratio: ((1 - stored.length / data.length) * 100).toFixed(2),
      time: totalTime.toFixed(2),
      filename,
      mode: 'Stored (already optimal)',
      speed: ((data.length / 1024 / 1024) / (totalTime / 1000)).toFixed(2),
      expanded: true
    };

    return { compressed: stored, stats: storedStats };
  }

  const finalStats = {
    ...stats,
    originalSize: data.length,
    compressedSize: output.length,
    ratio: ((1 - output.length / data.length) * 100).toFixed(2),
    time: totalTime.toFixed(2),
    filename,
    mode: ['Huffman', 'LZ77', 'Combined (LZ77 + Huffman)'][mode],
    speed: ((data.length / 1024 / 1024) / (totalTime / 1000)).toFixed(2)
  };

  return { compressed: output, stats: finalStats };
}

/**
 * Compress + Encrypt. Compresses first, then encrypts the entire output.
 * Returns a .compx.enc file.
 */
async function compressAndEncrypt(data, filename, mode, password, onProgress) {
  // Phase 1: Compress (70% of progress)
  const compressProgress = (p) => { if (onProgress) onProgress(p * 0.7); };
  const compressResult = compress(data, filename, mode, compressProgress);

  // Phase 2: Encrypt (30% of progress)
  const encryptProgress = (p) => { if (onProgress) onProgress(0.7 + p * 0.3); };
  const encryptResult = await self.Encryption.encrypt(compressResult.compressed, password, encryptProgress);

  // Wrap in envelope: [MAGIC:4][VERSION:1][FLAGS:1 with encrypted bit][encrypted payload]
  const envelopeSize = 4 + 1 + 1 + encryptResult.encrypted.length;
  const output = new Uint8Array(envelopeSize);
  output.set(MAGIC, 0);
  output[4] = FORMAT_VERSION;
  output[5] = (mode & 0x03) | 0x04; // bit 2 = encrypted
  output.set(encryptResult.encrypted, 6);

  const finalStats = {
    ...compressResult.stats,
    compressedSize: output.length,
    ratio: ((1 - output.length / data.length) * 100).toFixed(2),
    encrypted: true,
    encryptionMethod: encryptResult.stats.method
  };

  return { compressed: output, stats: finalStats };
}

function decompress(data, onProgress) {
  const totalStart = performance.now();

  if (data.length < 6) {
    throw new Error('Invalid file: too short');
  }

  if (data[0] !== MAGIC[0] || data[1] !== MAGIC[1] ||
      data[2] !== MAGIC[2] || data[3] !== MAGIC[3]) {
    throw new Error('Invalid .compx file: bad magic bytes');
  }

  const version = data[4];
  if (version !== FORMAT_VERSION && version !== 1) {
    throw new Error(`Unsupported format version: ${version}`);
  }

  const flags = data[5];
  const isEncrypted = (flags & 0x04) !== 0;

  if (isEncrypted) {
    throw new Error('This file is encrypted. Use decryptAndDecompress() with a password.');
  }

  // For v1 compatibility: flags byte was just the mode
  const mode = version === 1 ? flags : (flags & 0x03);

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const filenameLength = view.getUint16(6, false);
  const filename = new TextDecoder().decode(data.subarray(8, 8 + filenameLength));
  const headerSize = 8 + filenameLength;
  const compressedPayload = data.subarray(headerSize);

  const decompressProgress = (p) => { if (onProgress) onProgress(p * 0.9); };

  let result;

  switch (mode) {
    case MODE.HUFFMAN: {
      result = self.HuffmanCoding.decode(compressedPayload, decompressProgress);
      break;
    }
    case MODE.LZ77: {
      result = self.LZ77.decode(compressedPayload, decompressProgress);
      break;
    }
    case MODE.COMBINED: {
      const huffProgress = (p) => { if (onProgress) onProgress(p * 0.45); };
      const huffResult = self.HuffmanCoding.decode(compressedPayload, huffProgress);

      const lz77Progress = (p) => { if (onProgress) onProgress(0.45 + p * 0.45); };
      const lz77Result = self.LZ77.decode(huffResult.decompressed, lz77Progress);

      result = { decompressed: lz77Result.decompressed };
      break;
    }
    case 3: {
      // STORED mode: data was not compressed (original was already optimal)
      result = { decompressed: compressedPayload };
      break;
    }
    default:
      throw new Error(`Unknown compression mode: ${mode}`);
  }

  const totalTime = performance.now() - totalStart;
  if (onProgress) onProgress(1);

  return {
    decompressed: result.decompressed,
    filename,
    stats: {
      compressedSize: data.length,
      originalSize: result.decompressed.length,
      time: totalTime.toFixed(2),
      mode: ['Huffman', 'LZ77', 'Combined'][mode],
      filename
    }
  };
}

/**
 * Decrypt + Decompress. Decrypts the encrypted envelope, then decompresses.
 */
async function decryptAndDecompress(data, password, onProgress) {
  const totalStart = performance.now();

  if (data.length < 6) {
    throw new Error('Invalid file: too short');
  }

  if (data[0] !== MAGIC[0] || data[1] !== MAGIC[1] ||
      data[2] !== MAGIC[2] || data[3] !== MAGIC[3]) {
    throw new Error('Invalid .compx.enc file: bad magic bytes');
  }

  const version = data[4];
  const flags = data[5];
  const isEncrypted = (flags & 0x04) !== 0;

  if (!isEncrypted) {
    throw new Error('This file is not encrypted. Use decompress() instead.');
  }

  // Phase 1: Decrypt (30% of progress)
  const encryptedPayload = data.subarray(6);
  const decryptProgress = (p) => { if (onProgress) onProgress(p * 0.3); };
  const decryptResult = await self.Encryption.decrypt(encryptedPayload, password, decryptProgress);

  // Phase 2: Decompress the inner .compx data (70% of progress)
  const innerData = decryptResult.decrypted;
  const decompressProgress = (p) => { if (onProgress) onProgress(0.3 + p * 0.7); };
  const decompressResult = decompress(innerData, decompressProgress);

  const totalTime = performance.now() - totalStart;

  return {
    decompressed: decompressResult.decompressed,
    filename: decompressResult.filename,
    stats: {
      ...decompressResult.stats,
      encrypted: true,
      encryptionMethod: 'AES-GCM-256 + PBKDF2',
      time: totalTime.toFixed(2)
    }
  };
}

if (typeof self !== 'undefined' && typeof module === 'undefined') {
  self.Compressor = { compress, decompress, compressAndEncrypt, decryptAndDecompress, MODE };
}
if (typeof module !== 'undefined') {
  module.exports = { compress, decompress, compressAndEncrypt, decryptAndDecompress, MODE };
}
