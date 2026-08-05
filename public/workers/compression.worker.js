importScripts(
  '../algorithms/huffman.js',
  '../algorithms/lz77.js',
  '../algorithms/compressor.js'
);

self.onmessage = function(e) {
  const { action, buffer, filename, mode } = e.data;

  try {
    const data = new Uint8Array(buffer);

    const onProgress = (value) => {
      self.postMessage({ type: 'progress', value });
    };

    if (action === 'compress') {
      const result = self.Compressor.compress(data, filename, mode, onProgress);

      const outBuffer = result.compressed.buffer.slice(
        result.compressed.byteOffset,
        result.compressed.byteOffset + result.compressed.byteLength
      );

      self.postMessage(
        { type: 'result', buffer: outBuffer, stats: result.stats, filename: filename + '.compx' },
        [outBuffer]
      );

    } else if (action === 'decompress') {
      const result = self.Compressor.decompress(data, onProgress);

      const outBuffer = result.decompressed.buffer.slice(
        result.decompressed.byteOffset,
        result.decompressed.byteOffset + result.decompressed.byteLength
      );

      self.postMessage(
        { type: 'result', buffer: outBuffer, stats: result.stats, filename: result.filename },
        [outBuffer]
      );

    } else {
      throw new Error(`Unknown action: ${action}`);
    }

  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  }
};
