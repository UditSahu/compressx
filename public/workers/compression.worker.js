importScripts(
  '../algorithms/huffman.js',
  '../algorithms/lz77.js',
  '../algorithms/encryption.js',
  '../algorithms/compressor.js'
);

self.onmessage = async function(e) {
  const { action, buffer, filename, mode, password, encrypted } = e.data;

  try {
    const data = new Uint8Array(buffer);

    const onProgress = (value) => {
      self.postMessage({ type: 'progress', value });
    };

    if (action === 'compress') {
      let result;

      if (encrypted && password) {
        // Compress + Encrypt
        result = await self.Compressor.compressAndEncrypt(data, filename, mode, password, onProgress);
        const outBuffer = result.compressed.buffer.slice(
          result.compressed.byteOffset,
          result.compressed.byteOffset + result.compressed.byteLength
        );
        self.postMessage(
          { type: 'result', buffer: outBuffer, stats: result.stats, filename: filename + '.compx.enc' },
          [outBuffer]
        );
      } else {
        // Compress only
        result = self.Compressor.compress(data, filename, mode, onProgress);
        const outBuffer = result.compressed.buffer.slice(
          result.compressed.byteOffset,
          result.compressed.byteOffset + result.compressed.byteLength
        );
        self.postMessage(
          { type: 'result', buffer: outBuffer, stats: result.stats, filename: filename + '.compx' },
          [outBuffer]
        );
      }

    } else if (action === 'decompress') {
      let result;

      // Check if file is encrypted (magic bytes + encrypted flag)
      const isEncrypted = data.length >= 6 && (data[5] & 0x04) !== 0;

      if (isEncrypted) {
        if (!password) {
          self.postMessage({ type: 'need_password' });
          return;
        }
        result = await self.Compressor.decryptAndDecompress(data, password, onProgress);
      } else {
        result = self.Compressor.decompress(data, onProgress);
      }

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
