/**
 * Web Worker for media compression/decompression.
 * Handles image compression using DCT pipeline.
 * Video frame extraction must happen in main thread (needs DOM),
 * but encoding/decoding happens here.
 */

importScripts(
  '../algorithms/huffman.js',
  '../algorithms/image-compressor.js',
  '../algorithms/video-compressor.js'
);

self.onmessage = function(e) {
  const { action, data } = e.data;

  try {
    switch (action) {
      case 'compress-image': {
        const { pixels, width, height, quality, fileSize, rawFileBuffer } = data;
        const pixelArray = new Uint8ClampedArray(pixels);
        const result = ImageCompressor.encode(pixelArray, width, height, quality, (p) => {
          self.postMessage({ type: 'progress', value: p });
        }, fileSize); // Pass actual file size for accurate stats

        // If compression expanded the file, pass through the original bytes
        if (result.stats.expanded && rawFileBuffer) {
          const originalBytes = new Uint8Array(rawFileBuffer);
          const passBuffer = originalBytes.buffer.slice(
            originalBytes.byteOffset,
            originalBytes.byteOffset + originalBytes.byteLength
          );
          self.postMessage({
            type: 'result',
            action: 'compress-image',
            buffer: passBuffer,
            stats: {
              ...result.stats,
              compressedSize: originalBytes.length,
              ratio: '0.00',
              algorithm: 'Stored (original already optimal)',
              expanded: true
            },
            filename: data.filename // Keep original filename
          }, [passBuffer]);
        } else {
          self.postMessage({
            type: 'result',
            action: 'compress-image',
            buffer: result.compressed.buffer,
            stats: result.stats,
            filename: data.filename.replace(/\.[^.]+$/, '') + '.cimg'
          }, [result.compressed.buffer]);
        }
        break;
      }

      case 'decompress-image': {
        const { buffer, filename } = data;
        const compressedData = new Uint8Array(buffer);
        const result = ImageCompressor.decode(compressedData, (p) => {
          self.postMessage({ type: 'progress', value: p });
        });

        self.postMessage({
          type: 'result',
          action: 'decompress-image',
          pixels: result.pixels.buffer,
          width: result.width,
          height: result.height,
          stats: result.stats,
          filename: filename.replace(/\.cimg$/, '.jpg')  // Output JPEG, not PNG
        }, [result.pixels.buffer]);
        break;
      }

      case 'compress-video-frames': {
        // Frames are passed from main thread after extraction
        const { frames, width, height, fps, quality, gopInterval, filename, fileSize } = data;

        // Reconstruct frame arrays from transferred buffers
        const frameArrays = frames.map(buf => new Uint8ClampedArray(buf));

        const result = VideoCompressor.encode(frameArrays, width, height, fps, quality, gopInterval, (p) => {
          self.postMessage({ type: 'progress', value: 0.3 + p * 0.7 }); // 0.3 was frame extraction
        }, fileSize);

        self.postMessage({
          type: 'result',
          action: 'compress-video',
          buffer: result.compressed.buffer,
          stats: result.stats,
          filename: filename.replace(/\.[^.]+$/, '') + '.cvid'
        }, [result.compressed.buffer]);
        break;
      }

      case 'decompress-video': {
        const { buffer, filename } = data;
        const compressedData = new Uint8Array(buffer);
        const result = VideoCompressor.decode(compressedData, (p) => {
          self.postMessage({ type: 'progress', value: p });
        });

        // Transfer all frame buffers
        const frameBuffers = result.frames.map(f => f.buffer);
        self.postMessage({
          type: 'result',
          action: 'decompress-video',
          frames: frameBuffers,
          width: result.width,
          height: result.height,
          fps: result.fps,
          stats: result.stats,
          filename: filename.replace(/\.cvid$/, '.webm')
        }, frameBuffers);
        break;
      }

      default:
        self.postMessage({ type: 'error', message: `Unknown action: ${action}` });
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
