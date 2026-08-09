/**
 * Custom DCT-Based Image Compressor — Built from scratch.
 *
 * Pipeline:
 *   Encode: Pixels → RGB→YCbCr → Chroma Subsampling 4:2:0 → 8×8 Block DCT
 *           → Quantization → Zigzag Scan → RLE → Huffman Encoding → .cimg
 *
 *   Decode: .cimg → Huffman Decode → RLE Decode → Zigzag Unscan
 *           → Dequantize → IDCT → Chroma Upsample → YCbCr→RGB → Pixels
 *
 * Uses the existing HuffmanCoding module for entropy coding.
 */

const CIMG_MAGIC = [0x43, 0x49, 0x4D, 0x47]; // "CIMG"
const CIMG_VERSION = 1;

// ─── Standard JPEG Luminance Quantization Table ───
const QUANT_LUMINANCE = [
  16, 11, 10, 16,  24,  40,  51,  61,
  12, 12, 14, 19,  26,  58,  60,  55,
  14, 13, 16, 24,  40,  57,  69,  56,
  14, 17, 22, 29,  51,  87,  80,  62,
  18, 22, 37, 56,  68, 109, 103,  77,
  24, 35, 55, 64,  81, 104, 113,  92,
  49, 64, 78, 87, 103, 121, 120, 101,
  72, 92, 95, 98, 112, 100, 103,  99
];

// ─── Standard JPEG Chrominance Quantization Table ───
const QUANT_CHROMINANCE = [
  17, 18, 24, 47, 99, 99, 99, 99,
  18, 21, 26, 66, 99, 99, 99, 99,
  24, 26, 56, 99, 99, 99, 99, 99,
  47, 66, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99
];

// ─── Zigzag scan order for 8×8 block ───
const ZIGZAG_ORDER = [
   0,  1,  8, 16,  9,  2,  3, 10,
  17, 24, 32, 25, 18, 11,  4,  5,
  12, 19, 26, 33, 40, 48, 41, 34,
  27, 20, 13,  6,  7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36,
  29, 22, 15, 23, 30, 37, 44, 51,
  58, 59, 52, 45, 38, 31, 39, 46,
  53, 60, 61, 54, 47, 55, 62, 63
];

// Reverse zigzag (position → zigzag index)
const ZIGZAG_REVERSE = new Uint8Array(64);
for (let i = 0; i < 64; i++) ZIGZAG_REVERSE[ZIGZAG_ORDER[i]] = i;

// ─── Precomputed DCT cosine table ───
// C[k][n] = cos((2n+1)*k*π / 16) for k,n in [0..7]
const COS_TABLE = new Float64Array(64);
for (let k = 0; k < 8; k++) {
  for (let n = 0; n < 8; n++) {
    COS_TABLE[k * 8 + n] = Math.cos(((2 * n + 1) * k * Math.PI) / 16);
  }
}

// ─── Scaling factors: alpha(0) = 1/√2, alpha(k) = 1 for k>0 ───
const ALPHA = new Float64Array(8);
ALPHA[0] = 1 / Math.SQRT2;
for (let i = 1; i < 8; i++) ALPHA[i] = 1;

// ═══════════════════════════════════════════════════════════════
// COLOR SPACE CONVERSION
// ═══════════════════════════════════════════════════════════════

/**
 * Convert RGB pixel data to YCbCr color space.
 * Y  =  0.299R + 0.587G + 0.114B
 * Cb = -0.1687R - 0.3313G + 0.5B + 128
 * Cr =  0.5R - 0.4187G - 0.0813B + 128
 */
function rgbToYCbCr(pixels, width, height) {
  const size = width * height;
  const Y  = new Float32Array(size);
  const Cb = new Float32Array(size);
  const Cr = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];

    Y[i]  =  0.299 * r + 0.587 * g + 0.114 * b;
    Cb[i] = -0.16874 * r - 0.33126 * g + 0.5 * b + 128;
    Cr[i] =  0.5 * r - 0.41869 * g - 0.08131 * b + 128;
  }

  return { Y, Cb, Cr };
}

/**
 * Convert YCbCr back to RGBA pixel data.
 */
function yCbCrToRgb(Y, Cb, Cr, width, height) {
  const size = width * height;
  const pixels = new Uint8ClampedArray(size * 4);

  for (let i = 0; i < size; i++) {
    const y  = Y[i];
    const cb = Cb[i] - 128;
    const cr = Cr[i] - 128;

    pixels[i * 4]     = y + 1.402 * cr;
    pixels[i * 4 + 1] = y - 0.34414 * cb - 0.71414 * cr;
    pixels[i * 4 + 2] = y + 1.772 * cb;
    pixels[i * 4 + 3] = 255;
  }

  return pixels;
}

// ═══════════════════════════════════════════════════════════════
// CHROMA SUBSAMPLING 4:2:0
// ═══════════════════════════════════════════════════════════════

/**
 * Subsample a channel by 2× in both dimensions (4:2:0).
 * Averages each 2×2 block into one sample.
 */
function chromaSubsample(channel, width, height) {
  const sw = Math.ceil(width / 2);
  const sh = Math.ceil(height / 2);
  const sub = new Float32Array(sw * sh);

  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      const x = sx * 2;
      const y = sy * 2;
      let sum = 0, count = 0;

      // Average the 2×2 block (handle edges)
      sum += channel[y * width + x]; count++;
      if (x + 1 < width) { sum += channel[y * width + x + 1]; count++; }
      if (y + 1 < height) { sum += channel[(y + 1) * width + x]; count++; }
      if (x + 1 < width && y + 1 < height) { sum += channel[(y + 1) * width + x + 1]; count++; }

      sub[sy * sw + sx] = sum / count;
    }
  }

  return { data: sub, width: sw, height: sh };
}

/**
 * Upsample a subsampled channel back to original dimensions.
 * Uses bilinear interpolation for smoother results.
 */
function chromaUpsample(sub, sw, sh, targetW, targetH) {
  const out = new Float32Array(targetW * targetH);

  for (let y = 0; y < targetH; y++) {
    for (let x = 0; x < targetW; x++) {
      // Map target pixel to subsampled coordinates
      const sx = (x / targetW) * sw - 0.25;
      const sy = (y / targetH) * sh - 0.25;

      const sx0 = Math.max(0, Math.floor(sx));
      const sy0 = Math.max(0, Math.floor(sy));
      const sx1 = Math.min(sw - 1, sx0 + 1);
      const sy1 = Math.min(sh - 1, sy0 + 1);

      const fx = sx - sx0;
      const fy = sy - sy0;

      const v00 = sub[sy0 * sw + sx0];
      const v10 = sub[sy0 * sw + sx1];
      const v01 = sub[sy1 * sw + sx0];
      const v11 = sub[sy1 * sw + sx1];

      out[y * targetW + x] = (1 - fx) * (1 - fy) * v00 +
                               fx * (1 - fy) * v10 +
                               (1 - fx) * fy * v01 +
                               fx * fy * v11;
    }
  }

  return out;
}

// ═══════════════════════════════════════════════════════════════
// DISCRETE COSINE TRANSFORM (DCT) — 8×8 BLOCKS
// ═══════════════════════════════════════════════════════════════

/**
 * Forward DCT on an 8×8 block.
 * F(u,v) = (1/4) * alpha(u) * alpha(v) * sum_{x,y} f(x,y) * cos(...) * cos(...)
 */
function dct8x8(block) {
  const result = new Float32Array(64);

  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let sum = 0;
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) {
          sum += block[x * 8 + y] * COS_TABLE[u * 8 + x] * COS_TABLE[v * 8 + y];
        }
      }
      result[u * 8 + v] = 0.25 * ALPHA[u] * ALPHA[v] * sum;
    }
  }

  return result;
}

/**
 * Inverse DCT on an 8×8 block.
 * f(x,y) = (1/4) * sum_{u,v} alpha(u)*alpha(v) * F(u,v) * cos(...) * cos(...)
 */
function idct8x8(coeffs) {
  const result = new Float32Array(64);

  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let sum = 0;
      for (let u = 0; u < 8; u++) {
        for (let v = 0; v < 8; v++) {
          sum += ALPHA[u] * ALPHA[v] * coeffs[u * 8 + v] *
                 COS_TABLE[u * 8 + x] * COS_TABLE[v * 8 + y];
        }
      }
      result[x * 8 + y] = 0.25 * sum;
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════
// QUANTIZATION
// ═══════════════════════════════════════════════════════════════

/**
 * Scale a base quantization table by quality factor (1-100).
 * Quality 50 = use base table as-is.
 * Quality < 50 = more aggressive quantization (smaller file, more artifacts).
 * Quality > 50 = less quantization (larger file, better quality).
 */
function scaleQuantTable(baseTable, quality) {
  const q = Math.max(1, Math.min(100, quality));
  const scale = q < 50 ? (5000 / q) : (200 - 2 * q);
  const table = new Int32Array(64);

  for (let i = 0; i < 64; i++) {
    table[i] = Math.max(1, Math.round((baseTable[i] * scale + 50) / 100));
  }

  return table;
}

/**
 * Quantize DCT coefficients by dividing by the quant table.
 */
function quantize(dctBlock, quantTable) {
  const result = new Int16Array(64);
  for (let i = 0; i < 64; i++) {
    result[i] = Math.round(dctBlock[i] / quantTable[i]);
  }
  return result;
}

/**
 * Dequantize by multiplying by the quant table.
 */
function dequantize(quantized, quantTable) {
  const result = new Float32Array(64);
  for (let i = 0; i < 64; i++) {
    result[i] = quantized[i] * quantTable[i];
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// ZIGZAG SCAN
// ═══════════════════════════════════════════════════════════════

/**
 * Reorder an 8×8 block into zigzag order (low frequency → high frequency).
 */
function zigzagScan(block) {
  const result = new Int16Array(64);
  for (let i = 0; i < 64; i++) {
    result[i] = block[ZIGZAG_ORDER[i]];
  }
  return result;
}

/**
 * Reverse zigzag scan back to 8×8 block order.
 */
function zigzagUnscan(zigzagged) {
  const result = new Int16Array(64);
  for (let i = 0; i < 64; i++) {
    result[ZIGZAG_ORDER[i]] = zigzagged[i];
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// RUN-LENGTH ENCODING (for zero runs in quantized blocks)
// ═══════════════════════════════════════════════════════════════

/**
 * RLE encode a zigzag-scanned block.
 * Format: DC coefficient first (delta from previous block),
 * then AC as (runLength, value) pairs. End-of-block marker = (0, 0).
 *
 * Returns a flat Int16Array: [dc, numPairs, run0, val0, run1, val1, ...]
 */
function rleEncodeBlock(zigzagged, prevDC) {
  const dc = zigzagged[0] - prevDC;
  const pairs = [];
  let zeroRun = 0;

  for (let i = 1; i < 64; i++) {
    if (zigzagged[i] === 0) {
      zeroRun++;
    } else {
      // Split long runs (max 15 zeros per pair, like JPEG)
      while (zeroRun > 15) {
        pairs.push(15, 0); // ZRL: 15 zeros, value 0
        zeroRun -= 16;
      }
      pairs.push(zeroRun, zigzagged[i]);
      zeroRun = 0;
    }
  }
  // EOB marker — omitted if block is fully non-zero
  // We use numPairs to know when to stop, so EOB is implicit

  const out = new Int16Array(2 + pairs.length);
  out[0] = dc;
  out[1] = pairs.length / 2; // number of (run, value) pairs
  for (let i = 0; i < pairs.length; i++) out[2 + i] = pairs[i];

  return out;
}

/**
 * RLE decode back to a 64-element zigzag array.
 */
function rleDecodeBlock(encoded, prevDC) {
  const zigzagged = new Int16Array(64);
  zigzagged[0] = encoded[0] + prevDC;

  const numPairs = encoded[1];
  let pos = 1; // current position in zigzagged (starts after DC)

  for (let p = 0; p < numPairs; p++) {
    const run = encoded[2 + p * 2];
    const val = encoded[2 + p * 2 + 1];
    pos += run; // skip zeros
    if (pos < 64) {
      zigzagged[pos] = val;
      pos++;
    }
  }

  return zigzagged;
}

// ═══════════════════════════════════════════════════════════════
// CHANNEL PROCESSING — Full pipeline per channel
// ═══════════════════════════════════════════════════════════════

/**
 * Encode a single channel (Y, Cb, or Cr) through the full DCT pipeline.
 * Returns a byte array of RLE-encoded blocks ready for Huffman coding.
 */
function encodeChannel(channel, width, height, quantTable, onProgress, progressBase, progressRange) {
  // Pad to multiple of 8
  const padW = Math.ceil(width / 8) * 8;
  const padH = Math.ceil(height / 8) * 8;
  const blocksX = padW / 8;
  const blocksY = padH / 8;
  const totalBlocks = blocksX * blocksY;

  // Collect all RLE-encoded blocks
  const allBlocks = [];
  let prevDC = 0;
  let blocksDone = 0;

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      // Extract 8×8 block (with padding for edge blocks)
      const block = new Float32Array(64);
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const py = by * 8 + r;
          const px = bx * 8 + c;
          if (py < height && px < width) {
            block[r * 8 + c] = channel[py * width + px] - 128; // Level shift
          }
          // Padding: replicate edge pixel
          else {
            const cy = Math.min(py, height - 1);
            const cx = Math.min(px, width - 1);
            block[r * 8 + c] = channel[cy * width + cx] - 128;
          }
        }
      }

      // DCT → Quantize → Zigzag → RLE
      const dctCoeffs = dct8x8(block);
      const quantized = quantize(dctCoeffs, quantTable);
      const zigzagged = zigzagScan(quantized);
      const rle = rleEncodeBlock(zigzagged, prevDC);

      prevDC = zigzagged[0]; // Update DC predictor to current block's DC value

      allBlocks.push(rle);

      blocksDone++;
      if (onProgress && blocksDone % 100 === 0) {
        onProgress(progressBase + progressRange * (blocksDone / totalBlocks));
      }
    }
  }

  // Serialize all blocks into a flat Int16Array, then convert to bytes for Huffman
  // Format: [totalBlocks:uint32][block0...][block1...]
  // Each block: [length:uint16][data...]
  let totalSize = 4; // for totalBlocks count
  for (const blk of allBlocks) totalSize += 2 + blk.length * 2; // length prefix + data as int16s

  const serialized = new Uint8Array(totalSize);
  const dv = new DataView(serialized.buffer);
  dv.setUint32(0, totalBlocks, false);
  let offset = 4;

  for (const blk of allBlocks) {
    dv.setUint16(offset, blk.length, false);
    offset += 2;
    for (let i = 0; i < blk.length; i++) {
      dv.setInt16(offset, blk[i], false);
      offset += 2;
    }
  }

  return serialized;
}

/**
 * Decode a channel from serialized RLE data through the inverse pipeline.
 */
function decodeChannel(data, width, height, quantTable) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const totalBlocks = dv.getUint32(0, false);

  const padW = Math.ceil(width / 8) * 8;
  const padH = Math.ceil(height / 8) * 8;
  const blocksX = padW / 8;

  const channel = new Float32Array(width * height);
  let offset = 4;
  let prevDC = 0;

  for (let b = 0; b < totalBlocks; b++) {
    const len = dv.getUint16(offset, false);
    offset += 2;

    const encoded = new Int16Array(len);
    for (let i = 0; i < len; i++) {
      encoded[i] = dv.getInt16(offset, false);
      offset += 2;
    }

    // RLE decode → Zigzag unscan → Dequantize → IDCT
    const zigzagged = rleDecodeBlock(encoded, prevDC);
    prevDC = zigzagged[0]; // Update DC predictor

    const quantized = zigzagUnscan(zigzagged);
    const dctCoeffs = dequantize(quantized, quantTable);
    const block = idct8x8(dctCoeffs);

    // Write block back to channel (un-level-shift)
    const bx = (b % blocksX) * 8;
    const by = Math.floor(b / blocksX) * 8;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const py = by + r;
        const px = bx + c;
        if (py < height && px < width) {
          channel[py * width + px] = block[r * 8 + c] + 128;
        }
      }
    }
  }

  return channel;
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENCODE / DECODE
// ═══════════════════════════════════════════════════════════════

/**
 * Compress an image from raw RGBA pixel data.
 *
 * @param {Uint8ClampedArray} pixels - RGBA pixel data
 * @param {number} width
 * @param {number} height
 * @param {number} quality - 1 to 100
 * @param {function} [onProgress]
 * @param {number} [fileSize] - Actual file size on disk (for accurate stats)
 * @returns {{ compressed: Uint8Array, stats: object }}
 */
function encodeImage(pixels, width, height, quality, onProgress, fileSize) {
  const startTime = performance.now();
  quality = Math.max(1, Math.min(100, quality || 75));

  if (onProgress) onProgress(0.02);

  // 1. RGB → YCbCr
  const { Y, Cb, Cr } = rgbToYCbCr(pixels, width, height);
  if (onProgress) onProgress(0.08);

  // 2. Chroma subsampling 4:2:0
  const subCb = chromaSubsample(Cb, width, height);
  const subCr = chromaSubsample(Cr, width, height);
  if (onProgress) onProgress(0.12);

  // 3. Scale quantization tables
  const lumQuant = scaleQuantTable(QUANT_LUMINANCE, quality);
  const chrQuant = scaleQuantTable(QUANT_CHROMINANCE, quality);

  // 4. Encode each channel through DCT pipeline
  const yData = encodeChannel(Y, width, height, lumQuant, onProgress, 0.12, 0.35);
  if (onProgress) onProgress(0.47);

  const cbData = encodeChannel(subCb.data, subCb.width, subCb.height, chrQuant, onProgress, 0.47, 0.15);
  if (onProgress) onProgress(0.62);

  const crData = encodeChannel(subCr.data, subCr.width, subCr.height, chrQuant, onProgress, 0.62, 0.15);
  if (onProgress) onProgress(0.77);

  // 5. Combine channels and apply Huffman encoding
  const combined = new Uint8Array(12 + yData.length + cbData.length + crData.length);
  const combView = new DataView(combined.buffer);
  combView.setUint32(0, yData.length, false);
  combView.setUint32(4, cbData.length, false);
  combView.setUint32(8, crData.length, false);
  combined.set(yData, 12);
  combined.set(cbData, 12 + yData.length);
  combined.set(crData, 12 + yData.length + cbData.length);

  if (onProgress) onProgress(0.80);

  // Huffman encode the combined channel data
  const huffResult = self.HuffmanCoding.encode(combined, (p) => {
    if (onProgress) onProgress(0.80 + p * 0.15);
  });
  if (onProgress) onProgress(0.95);

  // 6. Build .cimg file
  // Header: [CIMG:4][version:1][quality:1][width:2][height:2] = 10 bytes
  const headerSize = 10;
  const output = new Uint8Array(headerSize + huffResult.compressed.length);
  const outView = new DataView(output.buffer);

  output[0] = CIMG_MAGIC[0];
  output[1] = CIMG_MAGIC[1];
  output[2] = CIMG_MAGIC[2];
  output[3] = CIMG_MAGIC[3];
  output[4] = CIMG_VERSION;
  output[5] = quality;
  outView.setUint16(6, width, false);
  outView.setUint16(8, height, false);
  output.set(huffResult.compressed, headerSize);

  const elapsed = performance.now() - startTime;
  if (onProgress) onProgress(1);

  // Use actual file size if provided (e.g., the JPG was 1.5 MB on disk),
  // otherwise fall back to raw RGBA pixel buffer size.
  const originalSize = fileSize || pixels.length;

  return {
    compressed: output,
    stats: {
      originalSize,
      compressedSize: output.length,
      ratio: ((1 - output.length / originalSize) * 100).toFixed(2),
      time: elapsed.toFixed(2),
      algorithm: 'DCT + Huffman',
      quality,
      width,
      height,
      mode: 'image'
    }
  };
}

/**
 * Decompress a .cimg file back to raw RGBA pixel data.
 *
 * @param {Uint8Array} data - .cimg file data
 * @param {function} [onProgress]
 * @returns {{ pixels: Uint8ClampedArray, width: number, height: number, stats: object }}
 */
function decodeImage(data, onProgress) {
  const startTime = performance.now();

  if (data.length < 10) throw new Error('Invalid .cimg: too short');

  // Verify magic
  if (data[0] !== CIMG_MAGIC[0] || data[1] !== CIMG_MAGIC[1] ||
      data[2] !== CIMG_MAGIC[2] || data[3] !== CIMG_MAGIC[3]) {
    throw new Error('Invalid .cimg: bad magic bytes');
  }

  const version = data[4];
  if (version !== CIMG_VERSION) throw new Error(`Unsupported .cimg version: ${version}`);

  const quality = data[5];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint16(6, false);
  const height = view.getUint16(8, false);

  if (onProgress) onProgress(0.05);

  // Huffman decode
  const huffData = data.slice(10); // slice() creates independent copy — safe for DataView
  const huffResult = self.HuffmanCoding.decode(huffData, (p) => {
    if (onProgress) onProgress(0.05 + p * 0.2);
  });
  if (onProgress) onProgress(0.25);

  // Split channels
  const combined = huffResult.decompressed;
  const combView = new DataView(combined.buffer, combined.byteOffset, combined.byteLength);
  const yLen = combView.getUint32(0, false);
  const cbLen = combView.getUint32(4, false);
  const crLen = combView.getUint32(8, false);

  const yData = combined.subarray(12, 12 + yLen);
  const cbData = combined.subarray(12 + yLen, 12 + yLen + cbLen);
  const crData = combined.subarray(12 + yLen + cbLen, 12 + yLen + cbLen + crLen);

  // Scale quantization tables
  const lumQuant = scaleQuantTable(QUANT_LUMINANCE, quality);
  const chrQuant = scaleQuantTable(QUANT_CHROMINANCE, quality);

  // Decode channels
  const subCbW = Math.ceil(width / 2);
  const subCbH = Math.ceil(height / 2);

  const Y = decodeChannel(yData, width, height, lumQuant);
  if (onProgress) onProgress(0.55);

  const subCb = decodeChannel(cbData, subCbW, subCbH, chrQuant);
  if (onProgress) onProgress(0.70);

  const subCr = decodeChannel(crData, subCbW, subCbH, chrQuant);
  if (onProgress) onProgress(0.82);

  // Chroma upsample
  const Cb = chromaUpsample(subCb, subCbW, subCbH, width, height);
  const Cr = chromaUpsample(subCr, subCbW, subCbH, width, height);
  if (onProgress) onProgress(0.90);

  // YCbCr → RGB
  const pixels = yCbCrToRgb(Y, Cb, Cr, width, height);

  const elapsed = performance.now() - startTime;
  if (onProgress) onProgress(1);

  return {
    pixels,
    width,
    height,
    stats: {
      compressedSize: data.length,
      originalSize: pixels.length,
      time: elapsed.toFixed(2),
      quality,
      algorithm: 'DCT + Huffman',
      mode: 'image'
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

if (typeof self !== 'undefined' && typeof module === 'undefined') {
  self.ImageCompressor = { encode: encodeImage, decode: decodeImage };
}
if (typeof module !== 'undefined') {
  module.exports = { encode: encodeImage, decode: decodeImage };
}
