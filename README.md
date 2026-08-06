<p align="center">
  <img src="assets/banner.png" alt="CompressX Banner" width="100%">
</p>

<h1 align="center">CompressX</h1>

<p align="center">
  <strong>File compression & encryption from scratch — Huffman Coding, LZ77, AES-256-GCM, and end-to-end file transfer, all running client-side in the browser.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Algorithms-Hand--Built-6c5ce7?style=flat-square" alt="Algorithms: Hand-Built">
  <img src="https://img.shields.io/badge/Encryption-AES--256--GCM-00b894?style=flat-square" alt="Encryption: AES-256-GCM">
  <img src="https://img.shields.io/badge/Dependencies-2-00cec9?style=flat-square" alt="Dependencies: 2">
  <img src="https://img.shields.io/badge/Frameworks-0-e17055?style=flat-square" alt="Frameworks: 0">
  <img src="https://img.shields.io/badge/Files_Never_Leave-Browser-fdcb6e?style=flat-square" alt="Files Never Leave Browser">
</p>

---

## What Is This

CompressX is a **real-time collaborative file compression & encryption tool** that implements compression algorithms **from the ground up** — no `pako`, no `zlib`, no library calls. Every byte of compression logic is written by hand in JavaScript. Encryption uses the browser's built-in **Web Crypto API** for real AES-256 security.

Upload a file, pick an algorithm, optionally encrypt with a password, and watch it compress with live stats, frequency analysis, and performance metrics — all happening client-side in a Web Worker so the UI never freezes.

Share a room with collaborators to see each other's compression results live via WebSockets, and **transfer compressed/encrypted files end-to-end** between browsers.

## Why This Exists

Most compression projects wrap a library and call it a day. This project exists to demonstrate **deep understanding** of how compression and encryption actually work at the bit level:

- **I built the min-heap priority queue** — no library
- **I built the Huffman tree** — from frequency analysis to bit-level code packing
- **I built the LZ77 engine** — hash-based match finder with chain tables, not naive string search
- **I combined them into a Deflate-lite pipeline** — the same architecture that powers gzip
- **I integrated AES-256-GCM encryption** — with PBKDF2 key derivation via Web Crypto API
- **I built chunked E2E file transfer** — compressed/encrypted files sent directly between browsers

```
Raw Data → LZ77 (find repeated patterns) → Huffman (optimal bit encoding) → AES-256 (encrypt) → Compressed & Encrypted Output
```

## Features

- 🔧 **Three compression modes** — Huffman, LZ77, Combined (Deflate-lite)
- 🔐 **AES-256-GCM encryption** — PBKDF2 key derivation, 100k iterations, browser-native crypto
- 📡 **End-to-end file transfer** — send compressed/encrypted files to room members over WebSocket
- 📊 **Live statistics** — ratio, speed (MB/s), time, byte frequency chart
- 📁 **Custom `.compx` / `.compx.enc` format** — compress and encrypt your own format
- ⚠️ **Smart file validation** — warns when uploading already-compressed files (zip, jpg, mp4, etc.)
- 🖱️ **Drag & drop** — or click to browse
- 👥 **Real-time collaboration** — create/join rooms, share results live
- 💬 **In-room chat** — coordinate with collaborators
- 🔒 **Client-side only** — files never touch the server
- 📱 **Responsive** — works on mobile
- ⚡ **Web Worker** — non-blocking compression & encryption

## Algorithms

### Huffman Coding

Entropy-based compression. Characters that appear frequently get shorter bit codes, rare characters get longer ones.

```
Implementation details:
├── Byte frequency analysis (Uint32Array[256])
├── Min-heap priority queue (hand-built binary heap)
├── Huffman tree construction (greedy algorithm)
├── Code table generation (array-based bit sequences, no 32-bit overflow)
├── Bit-level encoding with dynamic buffer growth
├── Single-symbol fast path (no bitstream needed)
└── Binary format with header (original size + flags + freq table + bitstream)
```

**Best for:** Text files, source code, logs — anything with skewed character frequencies.

### LZ77

Dictionary-based compression. Replaces repeated byte sequences with back-references (offset, length).

```
Implementation details:
├── Sliding window (4KB search buffer)
├── Hash-based match finder (3-byte hash → chain table)
├── Proper prev[] chain table (no hash collisions)
├── Long match splitting (matches > 18 bytes split into multiple tokens)
├── Chain depth limiting (max 64 candidates for performance)
├── Binary token format (flag bytes + literal/match encoding)
└── 12-bit offset + 4-bit length encoding per match
```

**Best for:** Files with repeating patterns — HTML, JSON, DNA sequences, structured data.

### Combined Mode (Deflate-lite)

Pipes LZ77 output through Huffman encoding — the same two-stage architecture used by gzip/Deflate, implemented from scratch.

```
Input → LZ77 (remove pattern redundancy) → Huffman (optimize bit usage) → Output
```

This typically achieves the best compression ratio because it attacks **both** types of redundancy.

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

**Pipeline with encryption enabled:**
```
File → Compress (Huffman/LZ77/Combined) → Encrypt (AES-256-GCM) → .compx.enc
```

## Architecture

```
12 files. 2 npm dependencies. Zero client-side frameworks.

├── server.js                          → Node.js (Express + WebSocket server + binary relay)
├── package.json                       → express + ws — that's it
│
└── public/
    ├── index.html                     → Semantic HTML5, SVG icons, Google Fonts
    ├── styles.css                     → Dark theme, CSS custom properties
    ├── app.js                         → Main controller (drag/drop, encryption UI, transfer)
    ├── websocket-client.js            → Auto-reconnect, rooms, chunked file transfer
    │
    ├── algorithms/
    │   ├── huffman.js                 → Huffman coding (encode + decode)
    │   ├── lz77.js                    → LZ77 (encode + decode)
    │   ├── encryption.js              → AES-256-GCM + PBKDF2 (Web Crypto API)
    │   └── compressor.js              → Pipeline, .compx/.compx.enc format, stats
    │
    └── workers/
        └── compression.worker.js      → Web Worker (compress + encrypt in background)
```

### Key Design Decisions

| Decision | Why |
|----------|-----|
| **Web Worker for compression** | Main thread stays responsive even on 50MB files |
| **Transferable ArrayBuffers** | Zero-copy data transfer between threads — no memory duplication |
| **Hash-based match finder** | O(1) average match lookup in LZ77, not O(n) naive search |
| **Array-based Huffman codes** | No 32-bit integer overflow — works for any tree depth |
| **Long match splitting** | Matches > 18 bytes correctly split into multiple tokens |
| **Web Crypto API for encryption** | Hardware-accelerated, browser-native, no JS crypto libraries |
| **PBKDF2 with 100k iterations** | Brute-force resistant key derivation |
| **64KB chunked file transfer** | Reliable WebSocket delivery without payload limits |
| **Smart file validation** | Warns on already-compressed formats (zip, jpg, mp4) |
| **Files never leave the browser** | Compression + encryption happen client-side; only metadata over WebSocket |
| **No bundler, no build step** | Clone → `npm install` → `npm start` → done |

## Quick Start

```bash
# Clone
git clone https://github.com/UditSahu/compressx.git
cd compressx

# Install (just 2 packages)
npm install

# Run
npm start

# Open
# → http://localhost:3000
```

## Usage

### Compress a file
1. Drop a file onto the upload zone (or click to browse)
2. Select an algorithm — **Huffman**, **LZ77**, or **Combined**
3. *(Optional)* Toggle **AES-256 Encryption** and enter a password
4. Click **Compress**
5. View stats → download the `.compx` or `.compx.enc` file

### Decompress
1. Drop a `.compx` file onto the upload zone
2. Click **Decompress**
3. Download the restored original

### Decrypt & Decompress
1. Drop a `.compx.enc` file onto the upload zone
2. Click **Decompress** → enter the encryption password
3. Download the restored original

### Send Files to Room Members
1. Compress (and optionally encrypt) a file
2. Click **Send to Room** — the file is transferred end-to-end over WebSocket
3. Room members receive the file with a progress bar and can download it

### Collaborate
1. Enter a name → click **Create Room**
2. Share the 6-character room code with others
3. When anyone compresses a file, all room members see the results live
4. Transfer compressed/encrypted files directly between browsers

## Compression Results

Tested on various file types:

| File Type | Size | Huffman | LZ77 | Combined |
|-----------|------|---------|------|----------|
| `.txt` (English prose) | 1.2 MB | ~40% saved | ~55% saved | ~60% saved |
| `.html` (web page) | 450 KB | ~35% saved | ~65% saved | ~70% saved |
| `.json` (API response) | 800 KB | ~38% saved | ~62% saved | ~68% saved |
| `.js` (source code) | 22 KB | ~32% saved | ~65% saved | ~63% saved |
| `.csv` (tabular data) | 2.1 MB | ~42% saved | ~60% saved | ~65% saved |
| `.png` (already compressed) | 500 KB | ~0% saved | ~0% saved | ~0% saved |

> **Note:** Already-compressed files (PNG, ZIP, MP4) won't shrink further — CompressX warns you when you try. You can still encrypt these files using AES-256 without compression.

## How the Algorithms Work

<details>
<summary><strong>Huffman Coding — Step by Step</strong></summary>

1. **Count frequencies** — scan every byte, count how often each value (0–255) appears
2. **Build min-heap** — insert all unique bytes as leaf nodes, ordered by frequency
3. **Build tree** — repeatedly extract two lowest-frequency nodes, merge them into a parent
4. **Generate codes** — traverse tree: left = `0`, right = `1`. Path to each leaf = its Huffman code (stored as bit arrays to avoid integer overflow)
5. **Encode** — replace each input byte with its variable-length bit code, pack into bytes
6. **Store metadata** — prepend frequency table so the decoder can rebuild the tree

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
3. **If match found** — emit a back-reference token: `(offset, length)`. Matches longer than 18 bytes are automatically split into multiple tokens.
4. **If no match** — emit the literal byte
5. **Advance** — move the window forward

```
Example: "ABCABCABC"
Position 0-2: "ABC"    → literals: A, B, C
Position 3:   "ABCABC" → match at offset=3, length=6
Output: [A][B][C][back 3, copy 6]
```

The hash-based match finder uses a hash of each 3-byte sequence to instantly find candidates, instead of scanning the entire window. Chain links are stored per-position (modulo window size) to avoid hash collisions.

</details>

<details>
<summary><strong>AES-256-GCM Encryption — Step by Step</strong></summary>

1. **Generate salt** — 16 random bytes (unique per encryption)
2. **Derive key** — PBKDF2 with SHA-256, 100,000 iterations, converts password → 256-bit AES key
3. **Generate IV** — 12 random bytes (unique per encryption)
4. **Encrypt** — AES-GCM authenticated encryption (confidentiality + integrity)
5. **Output** — `[salt:16 bytes][iv:12 bytes][ciphertext + 16-byte auth tag]`

Wrong password? AES-GCM's authentication tag detects it immediately — you get a clear error, not garbled output.

</details>

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Runtime** | Node.js | Lightweight, fast startup |
| **Server** | Express | Static file serving with caching headers |
| **WebSockets** | `ws` | Minimal, native binary support for file transfer |
| **Frontend** | Vanilla JS | Zero framework overhead, full control |
| **Styling** | Vanilla CSS | Custom properties, no Tailwind/Bootstrap |
| **Compute** | Web Workers | Off-main-thread compression & encryption |
| **Binary** | ArrayBuffer/Uint8Array | Native binary operations |
| **Crypto** | Web Crypto API | Hardware-accelerated AES-256-GCM + PBKDF2 |

**Total production dependencies: 2** (`express` + `ws`)

## Project Structure Deep Dive

```
Compression + Encryption Pipeline:
┌──────────┐     ┌──────────┐     ┌──────────────┐     ┌──────────┐     ┌────────┐
│ File Drop │ ──→ │ ArrayBuf │ ──→ │  Web Worker  │ ──→ │ AES-256  │ ──→ │ Stats  │
│  (UI)     │     │ (zero-   │     │  (compress)  │     │  (opt.)  │     │ + File │
│           │     │  copy)   │     │  Huff/LZ77   │     │ encrypt  │     │        │
└──────────┘     └──────────┘     └──────────────┘     └──────────┘     └────────┘

End-to-End File Transfer:
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Client A │ ──→ │  Server  │ ──→ │ Client B │
│ compress │     │ (binary  │     │ receives │
│ encrypt  │     │  relay)  │     │ + saves  │
│ send     │     │          │     │ file     │
└──────────┘     └──────────┘     └──────────┘
  64KB chunks      Relay only      Reassemble
  over WS         (no storage)     + download

WebSocket Collaboration:
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Client A │ ──→ │  Server  │ ──→ │ Client B │
│ compress │     │ (rooms,  │     │ sees A's │
│ locally  │     │  events) │     │ results  │
└──────────┘     └──────────┘     └──────────┘
  File data         Only            Live stats
  stays here     metadata          + activity
```

## .compx File Format (v2)

```
Offset  Size    Description
──────  ──────  ────────────────────────────────
0       4       Magic bytes: "CMPX" (0x43 0x4D 0x50 0x58)
4       1       Format version (2)
5       1       Flags: bits 0-1 = mode (0=Huffman, 1=LZ77, 2=Combined)
                       bit 2 = encrypted (0=no, 1=yes → .compx.enc)
6       2       Filename length (uint16 BE)
8       N       Original filename (UTF-8)
8+N     ...     Compressed payload (optionally wrapped in AES-GCM envelope)
```

## License

MIT

---

<p align="center">
  <sub>Built from scratch. No compression libraries were harmed in the making of this project.</sub>
</p>
