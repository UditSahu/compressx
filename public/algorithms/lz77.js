const WINDOW_SIZE = 4096;
const LOOKAHEAD_SIZE = 258;
const MIN_MATCH_LENGTH = 3;
const MAX_ENCODED_LENGTH = MIN_MATCH_LENGTH + 15; // 18 bytes max per token
const HASH_SIZE = 4096;
const HASH_MASK = HASH_SIZE - 1;

function hash3(data, pos) {
  if (pos + 2 >= data.length) return 0;
  return ((data[pos] << 8) ^ (data[pos + 1] << 4) ^ data[pos + 2]) & HASH_MASK;
}

/**
 * Find best match using hash chains.
 * Uses a proper prev[] array sized to WINDOW_SIZE to avoid chain table collisions.
 */
function findMatch(data, pos, hashTable, prevTable) {
  let bestOffset = 0;
  let bestLength = 0;

  if (pos + MIN_MATCH_LENGTH > data.length) return { offset: 0, length: 0 };

  const h = hash3(data, pos);
  let candidate = hashTable[h];
  const minPos = Math.max(0, pos - WINDOW_SIZE);
  let chainsLeft = 64;

  while (candidate >= minPos && candidate < pos && chainsLeft-- > 0) {
    if (data[candidate + bestLength] === data[pos + bestLength] &&
        data[candidate] === data[pos]) {

      let len = 0;
      const maxLen = Math.min(LOOKAHEAD_SIZE, data.length - pos);
      while (len < maxLen && data[candidate + len] === data[pos + len]) {
        len++;
      }

      if (len > bestLength) {
        bestLength = len;
        bestOffset = pos - candidate;
        if (len >= LOOKAHEAD_SIZE) break;
      }
    }

    // Follow the chain using prev[] indexed by (candidate % WINDOW_SIZE)
    const prevPos = prevTable[candidate % WINDOW_SIZE];
    if (prevPos >= candidate || prevPos < minPos) break; // prevent infinite loops
    candidate = prevPos;
  }

  if (bestLength < MIN_MATCH_LENGTH) {
    return { offset: 0, length: 0 };
  }

  return { offset: bestOffset, length: bestLength };
}

/**
 * Insert a position into the hash chain.
 */
function insertHash(data, pos, hashTable, prevTable) {
  if (pos + MIN_MATCH_LENGTH > data.length) return;
  const h = hash3(data, pos);
  // Store the previous head of this hash chain
  prevTable[pos % WINDOW_SIZE] = hashTable[h];
  hashTable[h] = pos;
}

function lz77Encode(data, onProgress) {
  const startTime = performance.now();

  if (data.length === 0) {
    const out = new Uint8Array(4);
    return {
      compressed: out,
      stats: { originalSize: 0, compressedSize: 4, ratio: '0.00', time: '0.00', algorithm: 'lz77' }
    };
  }

  const hashTable = new Int32Array(HASH_SIZE).fill(-1);
  // prev[] is indexed by (pos % WINDOW_SIZE), stores previous chain link
  const prevTable = new Int32Array(WINDOW_SIZE).fill(-1);

  const tokens = [];
  let pos = 0;
  const progressStep = Math.max(1, Math.floor(data.length / 50));
  let matchCount = 0;
  let literalCount = 0;

  while (pos < data.length) {
    const match = findMatch(data, pos, hashTable, prevTable);

    if (match.length >= MIN_MATCH_LENGTH) {
      // Split long matches into multiple tokens to avoid truncation.
      // Each token can encode at most MAX_ENCODED_LENGTH (18) bytes.
      let remaining = match.length;
      const matchOffset = match.offset;

      while (remaining >= MIN_MATCH_LENGTH) {
        const tokenLen = Math.min(remaining, MAX_ENCODED_LENGTH);
        tokens.push({ type: 1, offset: matchOffset, length: tokenLen });
        matchCount++;

        // Insert hash entries for positions we're advancing over
        for (let i = 0; i < tokenLen; i++) {
          insertHash(data, pos + i, hashTable, prevTable);
        }

        pos += tokenLen;
        remaining -= tokenLen;
        // The offset stays the SAME for continuation tokens.
        // After advancing pos by tokenLen, the source data also advanced
        // by the same amount, so the distance remains match.offset.
      }

      // Handle leftover bytes that are too short for a match token
      for (let i = 0; i < remaining; i++) {
        tokens.push({ type: 0, value: data[pos] });
        literalCount++;
        insertHash(data, pos, hashTable, prevTable);
        pos++;
      }
    } else {
      tokens.push({ type: 0, value: data[pos] });
      literalCount++;
      insertHash(data, pos, hashTable, prevTable);
      pos++;
    }

    if (onProgress && pos % progressStep === 0) {
      onProgress(0.1 + 0.7 * (pos / data.length));
    }
  }

  if (onProgress) onProgress(0.85);

  const estimatedSize = 4 + tokens.length * 3 + Math.ceil(tokens.length / 8);
  let output = new Uint8Array(Math.max(estimatedSize, 64));
  const view = new DataView(output.buffer);

  view.setUint32(0, data.length, false);
  let writePos = 4;

  for (let i = 0; i < tokens.length; i += 8) {
    // Ensure we have enough room for flag byte + up to 8 tokens * 2 bytes each
    if (writePos + 1 + 8 * 2 > output.length) {
      const newOutput = new Uint8Array(output.length * 2);
      newOutput.set(output);
      output = newOutput;
    }

    let flagByte = 0;
    const groupEnd = Math.min(i + 8, tokens.length);
    for (let j = i; j < groupEnd; j++) {
      if (tokens[j].type === 1) {
        flagByte |= (1 << (7 - (j - i)));
      }
    }
    output[writePos++] = flagByte;

    for (let j = i; j < groupEnd; j++) {
      const token = tokens[j];
      if (token.type === 0) {
        if (writePos >= output.length) {
          const newOutput = new Uint8Array(output.length * 2);
          newOutput.set(output);
          output = newOutput;
        }
        output[writePos++] = token.value;
      } else {
        if (writePos + 1 >= output.length) {
          const newOutput = new Uint8Array(output.length * 2);
          newOutput.set(output);
          output = newOutput;
        }
        // Encode: length is always (actualLen - MIN_MATCH_LENGTH), fits in 4 bits (0-15)
        // Offset fits in 12 bits (0-4095), matching WINDOW_SIZE
        const len = token.length - MIN_MATCH_LENGTH;
        const off = Math.min(token.offset, 0xFFF); // clamp to 12 bits
        output[writePos++] = ((off >> 8) & 0x0F) | ((len & 0x0F) << 4);
        output[writePos++] = off & 0xFF;
      }
    }
  }

  const compressed = output.subarray(0, writePos);
  const elapsed = performance.now() - startTime;
  if (onProgress) onProgress(1);

  return {
    compressed,
    stats: {
      originalSize: data.length,
      compressedSize: compressed.length,
      ratio: ((1 - compressed.length / data.length) * 100).toFixed(2),
      time: elapsed.toFixed(2),
      algorithm: 'lz77',
      matchCount,
      literalCount,
      avgMatchLength: matchCount > 0
        ? (tokens.filter(t => t.type === 1).reduce((s, t) => s + t.length, 0) / matchCount).toFixed(1)
        : 0
    }
  };
}

function lz77Decode(compressed, onProgress) {
  const startTime = performance.now();

  if (compressed.length < 4) {
    throw new Error('Invalid LZ77 data: too short');
  }

  const view = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
  const originalSize = view.getUint32(0, false);

  if (originalSize === 0) {
    return {
      decompressed: new Uint8Array(0),
      stats: { originalSize: 0, time: '0.00', algorithm: 'lz77' }
    };
  }

  const output = new Uint8Array(originalSize);
  let outPos = 0;
  let readPos = 4;

  const totalBytes = compressed.length - 4;
  const progressStep = Math.max(1, Math.floor(totalBytes / 50));

  while (readPos < compressed.length && outPos < originalSize) {
    if (readPos >= compressed.length) break;
    const flagByte = compressed[readPos++];

    for (let bit = 7; bit >= 0 && readPos < compressed.length && outPos < originalSize; bit--) {
      const isMatch = (flagByte >> bit) & 1;

      if (isMatch) {
        if (readPos + 1 >= compressed.length) break;
        const byte1 = compressed[readPos++];
        const byte2 = compressed[readPos++];

        const length = ((byte1 >> 4) & 0x0F) + MIN_MATCH_LENGTH;
        const offset = ((byte1 & 0x0F) << 8) | byte2;

        if (offset === 0 || offset > outPos) {
          throw new Error(`LZ77 decode error: invalid offset ${offset} at position ${outPos}`);
        }

        const srcPos = outPos - offset;
        for (let j = 0; j < length && outPos < originalSize; j++) {
          output[outPos++] = output[srcPos + j];
        }
      } else {
        if (readPos >= compressed.length) break;
        output[outPos++] = compressed[readPos++];
      }
    }

    if (onProgress && readPos % progressStep === 0) {
      onProgress(0.1 + 0.85 * (readPos / compressed.length));
    }
  }

  if (outPos !== originalSize) {
    throw new Error(`LZ77 decode error: expected ${originalSize} bytes but got ${outPos}`);
  }

  const elapsed = performance.now() - startTime;
  if (onProgress) onProgress(1);

  return {
    decompressed: output,
    stats: {
      originalSize,
      time: elapsed.toFixed(2),
      algorithm: 'lz77'
    }
  };
}

if (typeof self !== 'undefined' && typeof module === 'undefined') {
  self.LZ77 = { encode: lz77Encode, decode: lz77Decode };
}
if (typeof module !== 'undefined') {
  module.exports = { encode: lz77Encode, decode: lz77Decode };
}
