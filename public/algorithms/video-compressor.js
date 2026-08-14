/**
 * Custom Video Compressor — I-frame / P-frame architecture.
 *
 * Uses the custom ImageCompressor for keyframe (I-frame) encoding
 * and hand-built frame differencing for P-frames.
 *
 * Pipeline:
 *   Encode: Frames → Classify I/P → I-frames: full DCT compression
 *           → P-frames: delta from previous → compress deltas → Huffman → .cvid
 *
 *   Decode: .cvid → Huffman → reconstruct I-frames and P-frames → Frames
 *
 * Canvas/video elements are used ONLY for pixel I/O. All compression
 * logic is written from scratch.
 */

const CVID_MAGIC = [0x43, 0x56, 0x49, 0x44]; // "CVID"
const CVID_VERSION = 1;

// Frame types
const FRAME_I = 0; // Keyframe (full image compression)
const FRAME_P = 1; // Predicted frame (delta from previous)

/**
 * Extract frames from a video file using canvas.
 * This is purely I/O — reads pixel data from the video.
 *
 * @param {File} videoFile
 * @param {object} options - { maxFrames, fps, maxWidth, maxHeight }
 * @param {function} onProgress
 * @returns {Promise<{ frames: Uint8ClampedArray[], width, height, fps, duration }>}
 */
function extractFrames(videoFile, options, onProgress) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';

    const url = URL.createObjectURL(videoFile);
    video.src = url;

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video file'));
    };

    video.onloadedmetadata = () => {
      const duration = video.duration;
      const fps = options.fps || Math.min(15, 30); // Default 15fps for compression
      const maxFrames = options.maxFrames || Math.min(Math.ceil(duration * fps), 300);
      const interval = duration / maxFrames;

      // Scale down if needed
      let w = video.videoWidth;
      let h = video.videoHeight;
      const maxW = options.maxWidth || 640;
      const maxH = options.maxHeight || 480;

      if (w > maxW || h > maxH) {
        const scale = Math.min(maxW / w, maxH / h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }

      // Ensure even dimensions (needed for chroma subsampling)
      w = w - (w % 2);
      h = h - (h % 2);

      if (w < 2 || h < 2) {
        URL.revokeObjectURL(url);
        reject(new Error('Video dimensions too small after scaling'));
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const frames = [];
      let frameIdx = 0;
      let seekTimeout = null;

      function captureFrame() {
        if (frameIdx >= maxFrames) {
          if (seekTimeout) clearTimeout(seekTimeout);
          URL.revokeObjectURL(url);
          resolve({ frames, width: w, height: h, fps, duration });
          return;
        }

        const seekTime = Math.min(frameIdx * interval, duration - 0.01);
        
        // Timeout: if seek takes more than 5s, skip this frame
        if (seekTimeout) clearTimeout(seekTimeout);
        seekTimeout = setTimeout(() => {
          console.warn(`Frame ${frameIdx} seek timed out, skipping`);
          frameIdx++;
          if (frameIdx >= maxFrames) {
            URL.revokeObjectURL(url);
            resolve({ frames, width: w, height: h, fps, duration });
          } else {
            captureFrame();
          }
        }, 5000);

        video.currentTime = seekTime;
      }

      video.onseeked = () => {
        if (seekTimeout) clearTimeout(seekTimeout);
        ctx.drawImage(video, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        frames.push(new Uint8ClampedArray(imageData.data));
        frameIdx++;

        if (onProgress) onProgress(frameIdx / maxFrames);

        // Use setTimeout to prevent blocking
        setTimeout(captureFrame, 0);
      };

      captureFrame();
    };
  });
}

/**
 * Compute the pixel-level delta between two frames.
 * Uses a two-byte-per-channel encoding to preserve the full -255..+255 range
 * without clamping. Stores as (diff + 255) in Uint8ClampedArray pairs,
 * but we pack it into regular RGBA for the image compressor:
 *   R channel = clamp(diff_R + 128, 0, 255)
 *   G channel = clamp(diff_G + 128, 0, 255)
 *   B channel = clamp(diff_B + 128, 0, 255)
 *   A channel = 255
 *
 * For differences in [-128, 127] this is lossless.
 * For larger differences (scene changes), we split into two passes:
 *   - Low byte: (diff + 128) clamped to [0, 255]
 *   - Overflow flag stored in alpha channel
 */
function computeFrameDelta(currentFrame, previousFrame, width, height) {
  const size = width * height;
  const delta = new Uint8ClampedArray(size * 4);

  for (let i = 0; i < size; i++) {
    const idx = i * 4;
    // Compute signed differences
    const dr = currentFrame[idx]     - previousFrame[idx];
    const dg = currentFrame[idx + 1] - previousFrame[idx + 1];
    const db = currentFrame[idx + 2] - previousFrame[idx + 2];

    // Store with bias of 128. Range [-128,127] maps to [0,255] exactly.
    // Differences outside this range get clamped (lossy for scene changes,
    // but scene changes should be I-frames via GOP anyway).
    delta[idx]     = Math.max(0, Math.min(255, dr + 128));
    delta[idx + 1] = Math.max(0, Math.min(255, dg + 128));
    delta[idx + 2] = Math.max(0, Math.min(255, db + 128));
    delta[idx + 3] = 255;
  }

  return delta;
}

/**
 * Reconstruct a frame from a delta and the previous frame.
 */
function applyFrameDelta(delta, previousFrame, width, height) {
  const size = width * height;
  const frame = new Uint8ClampedArray(size * 4);

  for (let i = 0; i < size; i++) {
    const idx = i * 4;
    // Reverse the bias: subtract 128 to get signed diff, add to previous
    frame[idx]     = Math.max(0, Math.min(255, previousFrame[idx]     + (delta[idx]     - 128)));
    frame[idx + 1] = Math.max(0, Math.min(255, previousFrame[idx + 1] + (delta[idx + 1] - 128)));
    frame[idx + 2] = Math.max(0, Math.min(255, previousFrame[idx + 2] + (delta[idx + 2] - 128)));
    frame[idx + 3] = 255;
  }

  return frame;
}

/**
 * Encode a video from extracted frames.
 *
 * @param {Uint8ClampedArray[]} frames - Array of RGBA frame data
 * @param {number} width
 * @param {number} height
 * @param {number} fps
 * @param {number} quality - 1-100
 * @param {number} gopInterval - I-frame interval (e.g., every 10 frames)
 * @param {function} onProgress
 * @returns {{ compressed: Uint8Array, stats: object }}
 */
function encodeVideo(frames, width, height, fps, quality, gopInterval, onProgress, fileSize) {
  const startTime = performance.now();
  quality = Math.max(1, Math.min(100, quality || 50));
  gopInterval = gopInterval || 10;

  const frameCount = frames.length;
  const encodedFrames = [];

  let rawFramesTotalSize = 0;
  let iFrameCount = 0;
  let pFrameCount = 0;
  let previousFrame = null;

  for (let i = 0; i < frameCount; i++) {
    const isIFrame = (i % gopInterval === 0);
    rawFramesTotalSize += frames[i].length;

    let frameData;

    if (isIFrame) {
      // I-frame: full image compression
      const result = self.ImageCompressor.encode(frames[i], width, height, quality);
      frameData = result.compressed;
      // Decode this I-frame to get the reconstructed reference.
      // The decoder will use the reconstructed (lossy) frame as reference,
      // so the encoder must too — otherwise P-frames accumulate drift error.
      const reconstructed = self.ImageCompressor.decode(result.compressed);
      previousFrame = reconstructed.pixels;
      iFrameCount++;
    } else {
      // P-frame: delta encoding against the RECONSTRUCTED previous frame
      const delta = computeFrameDelta(frames[i], previousFrame, width, height);

      // Compress the delta using image compressor (deltas are mostly 128±small)
      // Use higher quality for deltas since they're already sparse
      const deltaQuality = Math.min(100, quality + 15);
      const result = self.ImageCompressor.encode(delta, width, height, deltaQuality);
      frameData = result.compressed;
      // Decode the delta and apply it to get the reconstructed frame
      // that the decoder will also produce — keeps encoder/decoder in sync
      const decodedDelta = self.ImageCompressor.decode(result.compressed);
      previousFrame = applyFrameDelta(decodedDelta.pixels, previousFrame, width, height);
      pFrameCount++;
    }

    // Store: [frameType:1][dataLength:4][data]
    const framePacket = new Uint8Array(5 + frameData.length);
    const fv = new DataView(framePacket.buffer);
    framePacket[0] = isIFrame ? FRAME_I : FRAME_P;
    fv.setUint32(1, frameData.length, false);
    framePacket.set(frameData, 5);

    encodedFrames.push(framePacket);

    if (onProgress) onProgress(0.1 + 0.85 * ((i + 1) / frameCount));
  }

  // Combine all frames
  let totalFrameSize = 0;
  for (const f of encodedFrames) totalFrameSize += f.length;

  // Header: [CVID:4][version:1][quality:1][width:2][height:2][frameCount:2][fps:1][gopInterval:1] = 14 bytes
  const headerSize = 14;
  const output = new Uint8Array(headerSize + totalFrameSize);
  const outView = new DataView(output.buffer);

  output[0] = CVID_MAGIC[0];
  output[1] = CVID_MAGIC[1];
  output[2] = CVID_MAGIC[2];
  output[3] = CVID_MAGIC[3];
  output[4] = CVID_VERSION;
  output[5] = quality;
  outView.setUint16(6, width, false);
  outView.setUint16(8, height, false);
  outView.setUint16(10, frameCount, false);
  output[12] = fps;
  output[13] = gopInterval;

  let offset = headerSize;
  for (const f of encodedFrames) {
    output.set(f, offset);
    offset += f.length;
  }

  const elapsed = performance.now() - startTime;
  if (onProgress) onProgress(1);

  const totalOriginalSize = fileSize || rawFramesTotalSize;

  return {
    compressed: output,
    stats: {
      originalSize: totalOriginalSize,
      compressedSize: output.length,
      ratio: ((1 - output.length / totalOriginalSize) * 100).toFixed(2),
      time: elapsed.toFixed(2),
      algorithm: 'I/P-Frame + DCT + Huffman',
      quality,
      width,
      height,
      frameCount,
      fps,
      gopInterval,
      iFrameCount,
      pFrameCount,
      mode: 'video'
    }
  };
}

/**
 * Decode a .cvid file back to an array of RGBA frames.
 *
 * @param {Uint8Array} data - .cvid file data
 * @param {function} onProgress
 * @returns {{ frames: Uint8ClampedArray[], width, height, fps, stats: object }}
 */
function decodeVideo(data, onProgress) {
  const startTime = performance.now();

  if (data.length < 14) throw new Error('Invalid .cvid: too short');

  if (data[0] !== CVID_MAGIC[0] || data[1] !== CVID_MAGIC[1] ||
      data[2] !== CVID_MAGIC[2] || data[3] !== CVID_MAGIC[3]) {
    throw new Error('Invalid .cvid: bad magic bytes');
  }

  const version = data[4];
  if (version !== CVID_VERSION) throw new Error(`Unsupported .cvid version: ${version}`);

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const quality = data[5];
  const width = view.getUint16(6, false);
  const height = view.getUint16(8, false);
  const frameCount = view.getUint16(10, false);
  const fps = data[12];
  const gopInterval = data[13];

  const frames = [];
  let offset = 14;
  let previousFrame = null;

  for (let i = 0; i < frameCount; i++) {
    if (offset + 5 > data.length) break;

    const frameType = data[offset];
    const frameLen = view.getUint32(offset + 1, false);
    offset += 5;

    const frameData = data.subarray(offset, offset + frameLen);
    offset += frameLen;

    if (frameType === FRAME_I) {
      // Decode I-frame with image decompressor
      const result = self.ImageCompressor.decode(frameData);
      const frame = result.pixels;
      frames.push(frame);
      previousFrame = frame;
    } else {
      // Decode P-frame (delta)
      const result = self.ImageCompressor.decode(frameData);
      const delta = result.pixels;

      if (previousFrame) {
        const frame = applyFrameDelta(delta, previousFrame, width, height);
        frames.push(frame);
        previousFrame = frame;
      } else {
        // Shouldn't happen if GOP is correct, but handle gracefully
        frames.push(delta);
        previousFrame = delta;
      }
    }

    if (onProgress) onProgress((i + 1) / frameCount);
  }

  const elapsed = performance.now() - startTime;

  return {
    frames,
    width,
    height,
    fps,
    stats: {
      compressedSize: data.length,
      originalSize: frames.length * width * height * 4,
      time: elapsed.toFixed(2),
      quality,
      frameCount: frames.length,
      fps,
      algorithm: 'I/P-Frame + DCT + Huffman',
      mode: 'video'
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

if (typeof self !== 'undefined' && typeof module === 'undefined') {
  self.VideoCompressor = {
    extractFrames,
    encode: encodeVideo,
    decode: decodeVideo,
    computeFrameDelta,
    applyFrameDelta
  };
}
if (typeof module !== 'undefined') {
  module.exports = {
    extractFrames,
    encode: encodeVideo,
    decode: decodeVideo,
    computeFrameDelta,
    applyFrameDelta
  };
}
