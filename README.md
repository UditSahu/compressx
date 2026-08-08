<p align="center">
  <img src="assets/banner.png" alt="CompressX Banner" width="100%">
</p>

<h1 align="center">CompressX</h1>

<p align="center">
  <strong>File, image & video compression from scratch — Huffman Coding, LZ77, DCT, I/P-Frame encoding, AES-256-GCM encryption, and real-time collaboration, all running client-side in the browser.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Algorithms-Hand--Built-6c5ce7?style=flat-square" alt="Algorithms: Hand-Built">
  <img src="https://img.shields.io/badge/Image-DCT+Huffman-f59e0b?style=flat-square" alt="Image: DCT+Huffman">
  <img src="https://img.shields.io/badge/Video-I/P_Frame+DCT-e17055?style=flat-square" alt="Video: I/P-Frame+DCT">
  <img src="https://img.shields.io/badge/Encryption-AES--256--GCM-00b894?style=flat-square" alt="Encryption: AES-256-GCM">
  <img src="https://img.shields.io/badge/Dependencies-3-00cec9?style=flat-square" alt="Dependencies: 3">
  <img src="https://img.shields.io/badge/Frameworks-0-fdcb6e?style=flat-square" alt="Frameworks: 0">
</p>

---

## What Is This

CompressX is a **real-time collaborative compression tool** that implements compression algorithms **from the ground up** — no `pako`, no `zlib`, no `ffmpeg`, no library calls. Every byte of compression logic is written by hand in JavaScript.

It compresses **files, images, and videos** using completely different algorithmic approaches:

| Input | Compression Pipeline | Output |
|-------|---------------------|--------|
| **Files** (text, JSON, code, etc.) | Huffman / LZ77 / Combined (Deflate-lite) | `.compx` |
| **Images** (JPEG, PNG, WebP, BMP, GIF) | RGB→YCbCr → Chroma 4:2:0 → 8×8 DCT → Quantization → Zigzag → RLE → Huffman | `.cimg` |
| **Videos** (MP4, WebM, AVI, MOV) | Frame extraction → I-frame (DCT) / P-frame (delta encoding) → Huffman | `.cvid` |
| **Any of the above** | + AES-256-GCM encryption (optional) | `.compx.enc` |

Everything happens client-side in Web Workers. Files never leave the browser.

## Why This Exists

Most compression projects wrap a library and call it a day. This project exists to demonstrate **deep understanding** of how compression actually works — from bit-level entropy coding to frequency-domain image transforms:

- **I built the min-heap priority queue** — no library
- **I built the Huffman tree** — from frequency analysis to bit-level code packing
- **I built the LZ77 engine** — lazy evaluation, hash-chain match finder, dynamic chain depth
- **I combined them into a Deflate-lite pipeline** — the same architecture that powers gzip
- **I built a DCT-based image compressor** — the same math that powers JPEG, from scratch
- **I built an I/P-frame video compressor** — keyframe + delta encoding, like real video codecs
- **I integrated AES-256-GCM encryption** — with PBKDF2 key derivation via Web Crypto API
- **I built chunked E2E file transfer** — with drain-based backpressure over WebSocket

## Features

- 🔧 **Three file compression modes** — Huffman, LZ77, Combined (Deflate-lite)
- 🖼️ **Image compression** — DCT-based pipeline (like JPEG) with adjustable quality (1-100)
- 🎬 **Video compression** — I/P-frame architecture with GOP control, FPS, and resolution settings
- 🔐 **AES-256-GCM encryption** — PBKDF2 key derivation, 100k iterations, browser-native crypto
- 📡 **End-to-end file transfer** — send compressed/encrypted files to room members over WebSocket
- 📊 **Live statistics** — ratio, speed (MB/s), time, byte frequency chart, PSNR for images
- 📁 **Custom formats** — `.compx`, `.cimg`, `.cvid` — all with documented headers
- 🎚️ **Quality control** — adjustable quality slider for image/video with real-time preview
- ⚠️ **Smart file detection** — auto-selects media controls for images/videos, warns on pre-compressed files
- 🖱️ **Drag & drop** — or click to browse
- 👥 **Real-time collaboration** — create/join rooms, share results live
- 💬 **In-room chat** — coordinate with collaborators
- 🔒 **Client-side only** — files never touch the server
- 📱 **Responsive** — works on mobile
- ⚡ **Web Workers** — non-blocking compression for all modes

## Algorithms

### Huffman Coding (File Compression)

Entropy-based compression. Characters that appear frequently get shorter bit codes, rare characters get longer ones.

```
Implementation details:
├── Byte frequency analysis (Uint32Array[256])
├── Min-heap priority queue (hand-built binary heap)
├── Huffman tree construction (greedy algorithm)
├── Multi-level lookup table decoder (512-entry primary + secondary tables)
├── BitWriter with 32-bit accumulator for fast batch encoding
├── Single-symbol fast path (6-byte header, no bitstream)
└── Binary format with header (original size + flags + freq table + bitstream)
```

**Best for:** Text files, source code, logs — anything with skewed character frequencies.

### LZ77 (File Compression)

Dictionary-based compression. Replaces repeated byte sequences with back-references (offset, length).

```
Implementation details:
├── Sliding window (4KB search buffer)
├── Improved hash function (XOR-shift, 8192-entry table)
├── Lazy evaluation (checks next position for longer match)
├── Dynamic chain depth (64 for small files, 128 for large)
├── Proper prev[] chain table (no hash collisions)
├── Long match splitting (matches > 18 bytes → multiple tokens)
└── 12-bit offset + 4-bit length encoding per match
```

**Best for:** Files with repeating patterns — HTML, JSON, DNA sequences, structured data.

### Combined Mode (Deflate-lite)

Pipes LZ77 output through Huffman encoding — the same two-stage architecture used by gzip/Deflate, implemented from scratch.

```
Input → LZ77 (remove pattern redundancy) → Huffman (optimize bit usage) → Output
```

### DCT Image Compression (JPEG-like)

Hand-built Discrete Cosine Transform pipeline — the same math that powers JPEG, written from scratch.

```
Encode pipeline:
├── RGB → YCbCr color space conversion
├── Chroma subsampling 4:2:0 (halves color resolution)
├── 8×8 block segmentation with edge padding
├── Forward DCT (precomputed cosine table)
├── Quantization (JPEG luminance + chrominance tables, quality-scaled)
├── Zigzag scan (low→high frequency ordering)
├── Run-length encoding (zero runs)
└── Huffman coding (reuses the same encoder from file compression!)

Decode pipeline:
├── Huffman decode (lookup table decoder)
├── RLE decode → Zigzag unscan
├── Dequantize → Inverse DCT
├── Chroma upsample (bilinear interpolation)
└── YCbCr → RGB → Canvas pixel output
```

**Quality control:** Slider from 1-100. Quality 50 = standard JPEG tables. Lower = more aggressive quantization = smaller file = more artifacts.

### I/P-Frame Video Compression

Custom video codec architecture — the same I-frame/P-frame concept used by real codecs like H.264.

```
Encode pipeline:
├── Frame extraction (canvas I/O only)
├── I-frames (every Nth frame): Full DCT image compression
├── P-frames (delta frames): Pixel difference from previous → DCT compress
├── GOP (Group of Pictures) interval control
└── Frame-by-frame Huffman entropy coding

Playback:
├── I-frame decode: Full IDCT reconstruction
├── P-frame decode: Apply delta to previous frame
└── Canvas animation with play/pause controls
```

### AES-256-GCM Encryption

Industry-standard authenticated encryption using the browser's Web Crypto API.

```
Implementation details:
├── PBKDF2 key derivation (SHA-256, 100,000 iterations)
├── Random 16-byte salt (unique per encryption)
├── Random 12-byte IV (unique per encryption)
├── AES-GCM 256-bit authenticated encryption
├── Tamper detection (wrong password → clear error, not garbled output)
└── Format: [salt:16][iv:12][ciphertext + auth tag]
```

## Architecture

```
16 files. 3 npm dependencies. Zero client-side frameworks.

├── server.js                          → Express + WebSocket + gzip middleware + backpressure
├── package.json                       → express + ws + compression — that's it
│
└── public/
    ├── index.html                     → Semantic HTML5, SVG icons, media controls
    ├── styles.css                     → Dark theme, CSS custom properties, GPU compositing
    ├── app.js                         → Controller (file/image/video detection, routing)
    ├── websocket-client.js            → Auto-reconnect, rooms, drain-based file transfer
    │
    ├── algorithms/
    │   ├── huffman.js                 → Huffman coding (lookup table decoder)
    │   ├── lz77.js                    → LZ77 (lazy eval, improved hash)
    │   ├── compressor.js              → File pipeline, .compx format
    │   ├── encryption.js              → AES-256-GCM + PBKDF2
    │   ├── image-compressor.js        → DCT image compression pipeline
    │   └── video-compressor.js        → I/P-frame video compression
    │
    └── workers/
        ├── compression.worker.js      → File compression worker
        └── media.worker.js            → Image/video compression worker
```

### Key Design Decisions

| Decision | Why |
|----------|-----|
| **Lazy evaluation in LZ77** | Checks if next position has a longer match — same technique as gzip |
| **Lookup table Huffman decoder** | O(1) symbol decode via 512-entry primary table, not O(n) tree walk |
| **DCT with precomputed cosines** | Avoids recalculating cos() 4 million times per image |
| **I/P-frame video architecture** | Only keyframes use full compression; delta frames are mostly zeros |
| **Quality-scaled quantization** | Same JPEG quantization tables, scaled by quality 1-100 |
| **Chroma subsampling 4:2:0** | Humans are less sensitive to color detail — safe to halve resolution |
| **gzip compression middleware** | 60-80% smaller HTTP responses for static assets |
| **Drain-based WebSocket transfer** | Send at max speed, only pause when buffer exceeds 256KB |
| **Web Workers for all modes** | Main thread stays responsive for files, images, and video |
| **Files never leave the browser** | Compression + encryption happen client-side; only metadata over WebSocket |
| **No bundler, no build step** | Clone → `npm install` → `npm start` → done |

## Quick Start

```bash
# Clone
git clone https://github.com/UditSahu/compressx.git
cd compressx

# Install (just 3 packages)
npm install

# Run
npm start

# Open
# → http://localhost:3000
```

## Usage

### Compress a File
1. Drop a file onto the upload zone (or click to browse)
2. Select an algorithm — **Huffman**, **LZ77**, or **Combined**
3. *(Optional)* Toggle **AES-256 Encryption** and enter a password
4. Click **Compress**
5. View stats → download the `.compx` file

### Compress an Image
1. Drop an image (JPEG, PNG, WebP, BMP, GIF, etc.)
2. CompressX auto-detects and shows the **quality slider** + preview
3. Adjust quality (1-100) — lower = smaller file, more artifacts
4. Click **Compress** → download the `.cimg` file
5. Drop the `.cimg` file back to decompress and view the result

### Compress a Video
1. Drop a video (MP4, WebM, AVI, MOV, etc.)
2. CompressX shows video settings: FPS, resolution, keyframe interval, max frames
3. Adjust quality and settings
4. Click **Compress** → download the `.cvid` file
5. Drop the `.cvid` file back to decompress and play with frame-by-frame controls

### Decompress
1. Drop a `.compx`, `.cimg`, or `.cvid` file
2. Click **Decompress** → view results and download

### Collaborate
1. Enter a name → click **Create Room**
2. Share the 6-character room code with others
3. When anyone compresses a file, all room members see the results live
4. Transfer compressed/encrypted files directly between browsers

## Compression Results

### File Compression

| File Type | Size | Huffman | LZ77 | Combined |
|-----------|------|---------|------|----------|
| `.txt` (English prose) | 1.2 MB | ~40% saved | ~55% saved | ~60% saved |
| `.html` (web page) | 16 KB | ~35% saved | ~68% saved | ~65% saved |
| `.json` (structured) | 29 KB | ~31% saved | ~59% saved | ~61% saved |
| `.js` (source code) | 22 KB | ~32% saved | ~66% saved | ~64% saved |
| `.css` (stylesheet) | 18 KB | ~32% saved | ~71% saved | ~67% saved |

### Image Compression (DCT Pipeline)

| Test Image | Quality 10 | Quality 50 | Quality 90 |
|------------|-----------|-----------|-----------|
| 64×64 smooth gradient | 92% saved, 30 dB | 91% saved, 40 dB | 89% saved, 51 dB |
| 100×75 photo-like | 95% saved, 29 dB | 93% saved, 37 dB | 90% saved, 43 dB |
| 200×150 textured | 95% saved, 14 dB | 85% saved, 16 dB | 66% saved, 17 dB |
| 128×128 random noise | 94% saved, 11 dB | 79% saved, 12 dB | 58% saved, 13 dB |

> PSNR > 30 dB is generally considered good visual quality. Smooth/photo-like images compress much better than random noise.

## How the Algorithms Work

<details>
<summary><strong>Huffman Coding — Step by Step</strong></summary>

1. **Count frequencies** — scan every byte, count how often each value (0–255) appears
2. **Build min-heap** — insert all unique bytes as leaf nodes, ordered by frequency
3. **Build tree** — repeatedly extract two lowest-frequency nodes, merge them into a parent
4. **Generate codes** — traverse tree: left = `0`, right = `1`. Path to each leaf = its Huffman code
5. **Encode** — replace each input byte with its variable-length bit code, pack into bytes
6. **Build lookup table** — 512-entry primary table for O(1) decoding

```
Example: "AABBBCCCC"
Frequencies: A=2, B=3, C=4
Huffman codes: C=0, B=10, A=11
Original:   9 bytes × 8 bits = 72 bits
Compressed: 4×1 + 3×2 + 2×2 = 14 bits = 2 bytes (+ header)
```

</details>

<details>
<summary><strong>LZ77 — Step by Step</strong></summary>

1. **Maintain a sliding window** — a 4KB buffer of recently seen data
2. **At each position**, search the window for the longest match with upcoming data
3. **Lazy evaluation** — check if the *next* position has a longer match. If so, emit current byte as literal and use the longer match instead (same technique as gzip)
4. **If match found** — emit a back-reference token: `(offset, length)`
5. **If no match** — emit the literal byte
6. **Advance** — move the window forward, update hash chains

```
Example: "ABCABCABC"
Position 0-2: "ABC"    → literals: A, B, C
Position 3:   "ABCABC" → match at offset=3, length=6
Output: [A][B][C][back 3, copy 6]
```

</details>

<details>
<summary><strong>DCT Image Compression — Step by Step</strong></summary>

1. **Color space conversion** — RGB → YCbCr. Separates brightness (Y) from color (Cb, Cr)
2. **Chroma subsampling** — halves Cb and Cr resolution (4:2:0). Humans are less sensitive to color detail
3. **Block segmentation** — divide each channel into 8×8 pixel blocks
4. **DCT** — Discrete Cosine Transform converts spatial data to frequency domain. Low frequencies (smooth areas) cluster in top-left; high frequencies (edges/detail) in bottom-right
5. **Quantization** — divide DCT coefficients by a quality matrix. High-frequency coefficients become zero — this is where compression happens (and quality loss)
6. **Zigzag scan** — read the 8×8 block in zigzag order, grouping all the zeros together
7. **Run-length encoding** — encode the long runs of zeros efficiently
8. **Huffman coding** — final entropy coding of the RLE data

```
Quality 90: Gentle quantization → few zeros → large file → sharp image
Quality 10: Aggressive quantization → many zeros → tiny file → blocky image
```

</details>

<details>
<summary><strong>Video I/P-Frame Compression — Step by Step</strong></summary>

1. **Extract frames** — read video at target FPS and resolution
2. **Classify frames** — every Nth frame is an I-frame (keyframe), rest are P-frames
3. **I-frame** — full DCT image compression (same pipeline as above)
4. **P-frame** — compute pixel-level difference from previous frame. Result is mostly zeros (128 = no change), so it compresses extremely well
5. **Encode** — each frame (I or P) is independently compressed and stored with a type marker

```
Frame 0 (I): Full image, compressed with DCT pipeline
Frame 1 (P): Only the changes from Frame 0 → mostly zeros → tiny
Frame 2 (P): Only the changes from Frame 1 → mostly zeros → tiny
...
Frame 10 (I): New keyframe → full image
Frame 11 (P): Delta from Frame 10
```

</details>

## Custom File Formats

### `.compx` — Compressed File (v2)
```
Offset  Size    Description
──────  ──────  ────────────────────────────────
0       4       Magic bytes: "CMPX" (0x43 0x4D 0x50 0x58)
4       1       Format version (2)
5       1       Flags: bits 0-1 = mode (0=Huffman, 1=LZ77, 2=Combined)
                       bit 2 = encrypted
6       2       Filename length (uint16 BE)
8       N       Original filename (UTF-8)
8+N     ...     Compressed payload
```

### `.cimg` — Compressed Image (v1)
```
Offset  Size    Description
──────  ──────  ────────────────────────────────
0       4       Magic bytes: "CIMG" (0x43 0x49 0x4D 0x47)
4       1       Version (1)
5       1       Quality (1-100)
6       2       Width (uint16 BE)
8       2       Height (uint16 BE)
10      ...     Huffman-encoded DCT channel data (Y + Cb + Cr)
```

### `.cvid` — Compressed Video (v1)
```
Offset  Size    Description
──────  ──────  ────────────────────────────────
0       4       Magic bytes: "CVID" (0x43 0x56 0x49 0x44)
4       1       Version (1)
5       1       Quality (1-100)
6       2       Width (uint16 BE)
8       2       Height (uint16 BE)
10      2       Frame count (uint16 BE)
12      1       FPS (uint8)
13      1       GOP interval (uint8)
14      ...     Frame data ([type:1][length:4][compressed frame data]...)
```

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Runtime** | Node.js | Lightweight, fast startup |
| **Server** | Express + compression | gzip middleware, tiered cache headers |
| **WebSockets** | `ws` | Binary support, backpressure handling |
| **Frontend** | Vanilla JS | Zero framework overhead, full control |
| **Styling** | Vanilla CSS | Custom properties, GPU compositing hints |
| **Compute** | Web Workers | Off-main-thread compression for all modes |
| **Binary** | ArrayBuffer/Uint8Array | Native binary operations, zero-copy transfers |
| **Crypto** | Web Crypto API | Hardware-accelerated AES-256-GCM + PBKDF2 |

**Total production dependencies: 3** (`express` + `ws` + `compression`)

## License

MIT

---

<p align="center">
  <sub>Built from scratch. No compression libraries, no image processing libraries, no video codecs — just math and bytes.</sub>
</p>
