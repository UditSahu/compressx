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
 * Generate code table using string-based bit sequences.
 * This avoids the 32-bit integer overflow that corrupts data
 * when Huffman codes exceed 31 bits in length.
 */
function generateCodeTable(root) {
  const table = new Array(256).fill(null);

  function traverse(node, codeBits) {
    if (node === null) return;
    if (node.byte !== null) {
      // Leaf node — store the code as an array of 0/1 values
      table[node.byte] = codeBits.length > 0 ? codeBits.slice() : [0];
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

class BitWriter {
  constructor(estimatedSize) {
    this.buffer = new Uint8Array(Math.max(estimatedSize, 1024));
    this.bytePos = 0;
    this.bitPos = 0;
    this.currentByte = 0;
  }

  /**
   * Write an array of bit values (0 or 1).
   * This replaces the old writeBits(code, length) that used integer shifts.
   */
  writeBitArray(bits) {
    for (let i = 0; i < bits.length; i++) {
      this.currentByte = (this.currentByte << 1) | bits[i];
      this.bitPos++;
      if (this.bitPos === 8) {
        this._ensureCapacity();
        this.buffer[this.bytePos++] = this.currentByte;
        this.currentByte = 0;
        this.bitPos = 0;
      }
    }
  }

  flush() {
    if (this.bitPos > 0) {
      const padding = 8 - this.bitPos;
      this.currentByte <<= padding;
      this._ensureCapacity();
      this.buffer[this.bytePos++] = this.currentByte;
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
    // Header: [originalSize:4][flags:1 = 0x08 for single-byte mode][byteValue:1][freq table:256*4]
    const headerSize = 4 + 1 + 1 + 256 * 4;
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

    // Write frequency table for compatibility
    for (let i = 0; i < 256; i++) {
      view.setUint32(6 + i * 4, freq[i], false);
    }

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
    writer.writeBitArray(entry);
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
  const output = new Uint8Array(headerSize + compressedData.length);
  const view = new DataView(output.buffer);

  view.setUint32(0, data.length, false);
  // flags byte: low 3 bits = padding, bit 3 = 0 (normal mode)
  // Old format had paddingBits at byte[4] directly, which is compatible
  // since paddingBits is always 0-7 (fits in low 3 bits) and bit 3 wasn't used
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

  const freq = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    freq[i] = view.getUint32(5 + i * 4, false);
  }
  if (onProgress) onProgress(0.1);

  const { tree } = buildHuffmanTree(freq);
  if (onProgress) onProgress(0.2);

  const headerSize = 4 + 1 + 256 * 4;
  const output = new Uint8Array(originalSize);
  let outPos = 0;
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
