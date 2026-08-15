class MinHeap {
  constructor() {
    this.heap = [];
  }

  get size() {
    return this.heap.length;
  }

  push(node) {
    this.heap.push(node);
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    if (this.heap.length === 0) return null;
    const min = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return min;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[i].freq < this.heap[parent].freq) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else break;
    }
  }

  _sinkDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.heap[left].freq < this.heap[smallest].freq) smallest = left;
      if (right < n && this.heap[right].freq < this.heap[smallest].freq) smallest = right;
      if (smallest !== i) {
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
        i = smallest;
      } else break;
    }
  }
}

class HuffmanNode {
  constructor(byte, freq, left = null, right = null) {
    this.byte = byte;
    this.freq = freq;
    this.left = left;
    this.right = right;
  }
}

function buildFrequencyTable(data) {
  const freq = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) {
    freq[data[i]]++;
  }
  return freq;
}

function buildHuffmanTree(freq) {
  const heap = new MinHeap();

  for (let i = 0; i < 256; i++) {
    if (freq[i] > 0) {
      heap.push(new HuffmanNode(i, freq[i]));
    }
  }

  if (heap.size === 0) {
    return { tree: new HuffmanNode(0, 0), uniqueCount: 0 };
  }
  if (heap.size === 1) {
    const only = heap.pop();
    return { tree: only, uniqueCount: 1 };
  }

  const uniqueCount = heap.size;

  while (heap.size > 1) {
    const left = heap.pop();
    const right = heap.pop();
    const merged = new HuffmanNode(null, left.freq + right.freq, left, right);
    heap.push(merged);
  }

  return { tree: heap.pop(), uniqueCount };
}

/**
 * Generate pre-packed code table.
 * Each entry is { bits: Uint8Array of 0/1, length: number, packed: number[], packLen: number }
 * The packed form groups bits into full bytes for faster bulk writes.
 */
function generateCodeTable(root) {
  const table = new Array(256).fill(null);

  function traverse(node, codeBits) {
    if (node === null) return;
    if (node.byte !== null) {
      const bits = codeBits.length > 0 ? codeBits.slice() : [0];
      table[node.byte] = {
        bits: bits,
        length: bits.length
      };
      return;
    }
    codeBits.push(0);
    traverse(node.left, codeBits);
    codeBits.pop();

    codeBits.push(1);
    traverse(node.right, codeBits);
    codeBits.pop();
  }

  traverse(root, []);
  return table;
}

/**
 * Optimized BitWriter with buffered byte output.
 * Accumulates bits in a 32-bit integer and flushes whole bytes,
 * reducing per-bit overhead significantly.
 */
class BitWriter {
  constructor(estimatedSize) {
    this.buffer = new Uint8Array(Math.max(estimatedSize, 1024));
    this.bytePos = 0;
    this.bitBuf = 0;   // 32-bit accumulator
    this.bitsInBuf = 0; // number of valid bits in bitBuf
  }

  /**
   * Write an array of bit values (0 or 1).
   * Uses a 32-bit accumulator for fast batched writes.
   */
  writeBitArray(bits) {
    for (let i = 0; i < bits.length; i++) {
      this.bitBuf = (this.bitBuf << 1) | bits[i];
      this.bitsInBuf++;
      if (this.bitsInBuf === 8) {
        this._ensureCapacity();
        this.buffer[this.bytePos++] = this.bitBuf;
        this.bitBuf = 0;
        this.bitsInBuf = 0;
      }
    }
  }

  flush() {
    if (this.bitsInBuf > 0) {
      const padding = 8 - this.bitsInBuf;
      this.bitBuf <<= padding;
      this._ensureCapacity();
      this.buffer[this.bytePos++] = this.bitBuf;
      return padding;
    }
    return 0;
  }

  getResult() {
    return this.buffer.subarray(0, this.bytePos);
  }

  _ensureCapacity() {
    if (this.bytePos >= this.buffer.length) {
      const newBuffer = new Uint8Array(this.buffer.length * 2);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
    }
  }
}

function huffmanEncode(data, onProgress) {
  const startTime = performance.now();

  if (data.length === 0) {
    // Empty file: 4 bytes original size (0) + 1 byte flags
    const header = new Uint8Array(5);
    return {
      compressed: header,
      stats: { originalSize: 0, compressedSize: 5, ratio: '0.00', time: '0.00', algorithm: 'huffman' }
    };
  }

  const freq = buildFrequencyTable(data);
  if (onProgress) onProgress(0.1);

  const { tree, uniqueCount } = buildHuffmanTree(freq);
  if (onProgress) onProgress(0.2);

  // Special case: single unique byte value
  // Just store the byte value and count — no bitstream needed
  if (uniqueCount === 1) {
    // Header: [originalSize:4][flags:1 = 0x08 for single-byte mode][byteValue:1]
    const headerSize = 4 + 1 + 1;
    const output = new Uint8Array(headerSize);
    const view = new DataView(output.buffer);

    view.setUint32(0, data.length, false);
    output[4] = 0x08; // flags: bit 3 = single-byte mode (avoids collision with paddingBits 0-7)

    // Find the single byte
    let singleByte = 0;
    for (let i = 0; i < 256; i++) {
      if (freq[i] > 0) { singleByte = i; break; }
    }
    output[5] = singleByte;

    const elapsed = performance.now() - startTime;
    if (onProgress) onProgress(1);

    return {
      compressed: output,
      stats: {
        originalSize: data.length,
        compressedSize: output.length,
        ratio: ((1 - output.length / data.length) * 100).toFixed(2),
        time: elapsed.toFixed(2),
        algorithm: 'huffman',
        uniqueBytes: 1,
        frequencyTable: Array.from(freq)
      }
    };
  }

  const codeTable = generateCodeTable(tree);
  if (onProgress) onProgress(0.3);

  const writer = new BitWriter(data.length);
  const progressStep = Math.max(1, Math.floor(data.length / 70));

  for (let i = 0; i < data.length; i++) {
    const entry = codeTable[data[i]];
    writer.writeBitArray(entry.bits);
    if (onProgress && i % progressStep === 0) {
      onProgress(0.3 + 0.6 * (i / data.length));
    }
  }

  const paddingBits = writer.flush();
  const compressedData = writer.getResult();
  if (onProgress) onProgress(0.95);

  // Header: [originalSize:4][flags:1 = paddingBits in low 3 bits, bit3=0 for normal mode]
  //         [freqTable:256*4][compressedData]
  const headerSize = 4 + 1 + 256 * 4;
  const huffmanOutputSize = headerSize + compressedData.length;

  // Safeguard: if Huffman encoding would expand the data, store raw bytes instead.
  // This is critical for high-entropy data (e.g., serialized DCT coefficients,
  // already-compressed data) where Huffman codes average >= 8 bits per symbol.
  // Uses bit 4 (0x10) in flags to indicate "stored" mode.
  const storedOutputSize = 4 + 1 + data.length; // originalSize + flags + raw data
  if (huffmanOutputSize >= storedOutputSize) {
    const stored = new Uint8Array(storedOutputSize);
    const storedView = new DataView(stored.buffer);
    storedView.setUint32(0, data.length, false);
    stored[4] = 0x10; // flags: bit 4 = stored/passthrough mode
    stored.set(data, 5);

    const elapsed = performance.now() - startTime;
    if (onProgress) onProgress(1);

    return {
      compressed: stored,
      stats: {
        originalSize: data.length,
        compressedSize: stored.length,
        ratio: ((1 - stored.length / data.length) * 100).toFixed(2),
        time: elapsed.toFixed(2),
        algorithm: 'huffman (stored)',
        uniqueBytes: uniqueCount,
        frequencyTable: Array.from(freq)
      }
    };
  }

  const output = new Uint8Array(huffmanOutputSize);
  const view = new DataView(output.buffer);

  view.setUint32(0, data.length, false);
  // flags byte: low 3 bits = padding, bit 3 = 0 (normal mode)
  output[4] = paddingBits & 0x07;

  for (let i = 0; i < 256; i++) {
    view.setUint32(5 + i * 4, freq[i], false);
  }

  output.set(compressedData, headerSize);

  const elapsed = performance.now() - startTime;
  if (onProgress) onProgress(1);

  return {
    compressed: output,
    stats: {
      originalSize: data.length,
      compressedSize: output.length,
      ratio: ((1 - output.length / data.length) * 100).toFixed(2),
      time: elapsed.toFixed(2),
      algorithm: 'huffman',
      uniqueBytes: uniqueCount,
      frequencyTable: Array.from(freq)
    }
  };
}

/**
 * Build a multi-level lookup table for fast Huffman decoding.
 *
 * Primary table: 2^PRIMARY_BITS entries. Each entry is either:
 *   - { symbol, length } for codes ≤ PRIMARY_BITS long (direct lookup)
 *   - { subtable, shift }  for codes longer than PRIMARY_BITS
 *
 * This avoids bit-by-bit tree traversal and typically resolves a symbol
 * in a single table lookup (O(1) instead of O(codeLength)).
 */
const PRIMARY_BITS = 9; // 512-entry primary table

function buildDecodeLookup(root, uniqueCount) {
  if (uniqueCount <= 1) return null; // handled separately

  // First, collect all codes by traversing the tree
  const codes = [];
  function collectCodes(node, bits, len) {
    if (node === null) return;
    if (node.byte !== null) {
      codes.push({ symbol: node.byte, bits, length: len || 1 });
      return;
    }
    collectCodes(node.left, (bits << 1) | 0, len + 1);
    collectCodes(node.right, (bits << 1) | 1, len + 1);
  }
  collectCodes(root, 0, 0);

  const primarySize = 1 << PRIMARY_BITS;
  // -1 = not filled; we store as flat array: [symbol, length] pairs
  // symbol = -1 means subtable redirect
  const primary = new Int16Array(primarySize * 2).fill(-1);

  // Secondary tables stored as Map for codes > PRIMARY_BITS
  const secondaryTables = new Map(); // key = prefix bits, value = {table, bits}

  for (const code of codes) {
    if (code.length <= PRIMARY_BITS) {
      // Fill all entries that share this prefix
      const fill = 1 << (PRIMARY_BITS - code.length);
      for (let j = 0; j < fill; j++) {
        const idx = (code.bits << (PRIMARY_BITS - code.length)) | j;
        primary[idx * 2] = code.symbol;
        primary[idx * 2 + 1] = code.length;
      }
    } else {
      // Long code: needs secondary table
      const prefixBits = code.bits >>> (code.length - PRIMARY_BITS);
      const suffixBits = code.bits & ((1 << (code.length - PRIMARY_BITS)) - 1);
      const suffixLen = code.length - PRIMARY_BITS;

      if (!secondaryTables.has(prefixBits)) {
        secondaryTables.set(prefixBits, { entries: [], maxBits: 0 });
      }
      const st = secondaryTables.get(prefixBits);
      st.entries.push({ symbol: code.symbol, bits: suffixBits, length: suffixLen });
      if (suffixLen > st.maxBits) st.maxBits = suffixLen;

      // Mark primary entry as redirect (symbol = -2)
      primary[prefixBits * 2] = -2;
      primary[prefixBits * 2 + 1] = prefixBits; // key into secondaryTables
    }
  }

  // Build secondary tables into flat arrays
  const builtSecondary = new Map();
  for (const [prefix, st] of secondaryTables) {
    const secSize = 1 << st.maxBits;
    const table = new Int16Array(secSize * 2).fill(-1);
    for (const entry of st.entries) {
      const fill = 1 << (st.maxBits - entry.length);
      for (let j = 0; j < fill; j++) {
        const idx = (entry.bits << (st.maxBits - entry.length)) | j;
        table[idx * 2] = entry.symbol;
        table[idx * 2 + 1] = entry.length + PRIMARY_BITS; // total length
      }
    }
    builtSecondary.set(prefix, { table, bits: st.maxBits });
  }

  return { primary, secondary: builtSecondary };
}

function huffmanDecode(compressed, onProgress) {
  const startTime = performance.now();

  if (compressed.length < 5) {
    throw new Error('Invalid Huffman data: too short');
  }

  const view = new DataView(compressed.buffer, compressed.byteOffset, compressed.byteLength);
  const originalSize = view.getUint32(0, false);
  const flags = compressed[4];

  if (originalSize === 0) {
    return {
      decompressed: new Uint8Array(0),
      stats: { originalSize: 0, time: '0.00', algorithm: 'huffman' }
    };
  }

  // Check stored/passthrough mode (bit 4 set) — data was not Huffman-compressed
  if (flags & 0x10) {
    const output = compressed.slice(5, 5 + originalSize);

    const elapsed = performance.now() - startTime;
    if (onProgress) onProgress(1);

    return {
      decompressed: output,
      stats: {
        originalSize,
        time: elapsed.toFixed(2),
        algorithm: 'huffman (stored)'
      }
    };
  }

  // Check single-byte mode (bit 3 set)
  if (flags & 0x08) {
    const singleByte = compressed[5];
    const output = new Uint8Array(originalSize);
    output.fill(singleByte);

    const elapsed = performance.now() - startTime;
    if (onProgress) onProgress(1);

    return {
      decompressed: output,
      stats: {
        originalSize,
        time: elapsed.toFixed(2),
        algorithm: 'huffman'
      }
    };
  }

  // Normal mode: paddingBits stored in low 3 bits of flags
  const paddingBits = flags & 0x07;
  if (paddingBits > 7) {
    throw new Error(`Huffman decode error: invalid padding bits value ${paddingBits}`);
  }

  const freq = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    freq[i] = view.getUint32(5 + i * 4, false);
  }
  if (onProgress) onProgress(0.1);

  const { tree, uniqueCount } = buildHuffmanTree(freq);
  if (onProgress) onProgress(0.15);

  // Build lookup table for fast decoding
  const lookup = buildDecodeLookup(tree, uniqueCount);
  if (onProgress) onProgress(0.2);

  const headerSize = 4 + 1 + 256 * 4;
  const output = new Uint8Array(originalSize);
  let outPos = 0;

  if (lookup) {
    // --- Fast table-based decoding ---
    // We maintain a bit buffer and consume bits via table lookups
    let bitBuf = 0;
    let bitsInBuf = 0;
    let byteIdx = headerSize;

    const totalCompressedBytes = compressed.length - headerSize;
    const progressStep = Math.max(1, Math.floor(originalSize / 70));

    while (outPos < originalSize) {
      // Refill bit buffer — load up to 4 bytes at a time
      while (bitsInBuf < 24 && byteIdx < compressed.length) {
        bitBuf = (bitBuf << 8) | compressed[byteIdx++];
        bitsInBuf += 8;
      }

      // Check we haven't consumed past actual data (accounting for padding)
      if (bitsInBuf <= 0) break;

      // Peek top PRIMARY_BITS from bit buffer
      const peekBits = (bitsInBuf >= PRIMARY_BITS)
        ? (bitBuf >>> (bitsInBuf - PRIMARY_BITS)) & ((1 << PRIMARY_BITS) - 1)
        : (bitBuf << (PRIMARY_BITS - bitsInBuf)) & ((1 << PRIMARY_BITS) - 1);

      const sym = lookup.primary[peekBits * 2];
      const codeLen = lookup.primary[peekBits * 2 + 1];

      if (sym >= 0) {
        // Direct hit
        output[outPos++] = sym;
        bitsInBuf -= codeLen;
      } else if (sym === -2) {
        // Secondary table lookup
        const secEntry = lookup.secondary.get(codeLen); // codeLen stores the prefix key
        if (!secEntry) {
          throw new Error('Huffman decode error: missing secondary table');
        }
        // Need more bits for secondary lookup
        const totalNeeded = PRIMARY_BITS + secEntry.bits;
        // Refill if needed
        while (bitsInBuf < totalNeeded && byteIdx < compressed.length) {
          bitBuf = (bitBuf << 8) | compressed[byteIdx++];
          bitsInBuf += 8;
        }
        const secPeek = (bitBuf >>> (bitsInBuf - totalNeeded)) & ((1 << secEntry.bits) - 1);
        const secSym = secEntry.table[secPeek * 2];
        const secLen = secEntry.table[secPeek * 2 + 1]; // total code length
        if (secSym < 0) {
          throw new Error('Huffman decode error: invalid secondary lookup');
        }
        output[outPos++] = secSym;
        bitsInBuf -= secLen;
      } else {
        // Fallback: bit-by-bit tree walk for safety
        let node = tree;
        while (node.byte === null && bitsInBuf > 0) {
          bitsInBuf--;
          const bit = (bitBuf >>> bitsInBuf) & 1;
          node = bit === 0 ? node.left : node.right;
          if (node === null) throw new Error('Huffman decode error: invalid bit sequence');
        }
        if (node.byte !== null) {
          output[outPos++] = node.byte;
        } else {
          break;
        }
      }

      // Mask off consumed bits to prevent overflow
      if (bitsInBuf < 32) {
        bitBuf &= (1 << bitsInBuf) - 1;
      }

      if (onProgress && outPos % progressStep === 0) {
        onProgress(0.2 + 0.75 * (outPos / originalSize));
      }
    }
  } else {
    // Fallback: original bit-by-bit decoder (for edge cases)
    let node = tree;
    const totalBits = (compressed.length - headerSize) * 8 - paddingBits;
    const progressStep = Math.max(1, Math.floor(totalBits / 70));
    let bitCount = 0;

    for (let byteIdx = headerSize; byteIdx < compressed.length; byteIdx++) {
      const byte = compressed[byteIdx];
      const bitsInThisByte = (byteIdx === compressed.length - 1) ? (8 - paddingBits) : 8;

      for (let bitIdx = 7; bitIdx >= 8 - bitsInThisByte; bitIdx--) {
        const bit = (byte >> bitIdx) & 1;
        node = bit === 0 ? node.left : node.right;

        if (node === null) {
          throw new Error('Huffman decode error: invalid bit sequence encountered');
        }

        if (node.byte !== null) {
          output[outPos++] = node.byte;
          node = tree;
          if (outPos >= originalSize) break;
        }

        bitCount++;
        if (onProgress && bitCount % progressStep === 0) {
          onProgress(0.2 + 0.75 * (bitCount / totalBits));
        }
      }
      if (outPos >= originalSize) break;
    }
  }

  if (outPos !== originalSize) {
    throw new Error(`Huffman decode error: expected ${originalSize} bytes but got ${outPos}`);
  }

  const elapsed = performance.now() - startTime;
  if (onProgress) onProgress(1);

  return {
    decompressed: output,
    stats: {
      originalSize,
      time: elapsed.toFixed(2),
      algorithm: 'huffman'
    }
  };
}

if (typeof self !== 'undefined' && typeof module === 'undefined') {
  self.HuffmanCoding = { encode: huffmanEncode, decode: huffmanDecode, buildFrequencyTable };
}
if (typeof module !== 'undefined') {
  module.exports = { encode: huffmanEncode, decode: huffmanDecode, buildFrequencyTable };
}
