const MAGIC = [0x43, 0x4D, 0x50, 0x58];
const FORMAT_VERSION = 1;

const MODE = {
  HUFFMAN: 0,
  LZ77: 1,
  COMBINED: 2
};

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
  const headerSize = 4 + 1 + 1 + 2 + filenameBytes.length;
  const output = new Uint8Array(headerSize + result.compressed.length);
  const view = new DataView(output.buffer);

  output.set(MAGIC, 0);
  output[4] = FORMAT_VERSION;
  output[5] = mode;
  view.setUint16(6, filenameBytes.length, false);
  output.set(filenameBytes, 8);
  output.set(result.compressed, headerSize);

  const totalTime = performance.now() - totalStart;
  if (onProgress) onProgress(1);

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

function decompress(data, onProgress) {
  const totalStart = performance.now();

  if (data[0] !== MAGIC[0] || data[1] !== MAGIC[1] ||
      data[2] !== MAGIC[2] || data[3] !== MAGIC[3]) {
    throw new Error('Invalid .compx file: bad magic bytes');
  }

  const version = data[4];
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported format version: ${version}`);
  }

  const mode = data[5];
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

if (typeof self !== 'undefined' && typeof module === 'undefined') {
  self.Compressor = { compress, decompress, MODE };
}
if (typeof module !== 'undefined') {
  module.exports = { compress, decompress, MODE };
}
