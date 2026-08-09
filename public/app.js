(function () {
  'use strict';

  let currentFile = null;
  let resultBuffer = null;
  let resultFilename = null;
  let resultEncrypted = false;
  let worker = null;
  let receivedFileData = null;
  let progressRAF = null;
  let lastProgressPct = -1;
  let mediaType = null; // 'image', 'video', or null for regular files
  let mediaWorker = null;
  let decompressedVideoFrames = null;
  let videoPlayInterval = null;
  const ws = new WSClient();

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // --- Compressed file extensions that won't benefit from further compression ---
  const COMPRESSED_EXTENSIONS = new Set([
    '.zip', '.rar', '.7z', '.gz', '.bz2', '.xz', '.lz', '.lzma', '.zst', '.br', '.lz4',
    '.tar.gz', '.tgz', '.tar.bz2', '.tar.xz',
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.heic', '.heif',
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.flv',
    '.mp3', '.aac', '.ogg', '.opus', '.wma', '.m4a', '.flac',
    '.woff', '.woff2',
    '.pdf',
    '.docx', '.xlsx', '.pptx',
    '.apk', '.ipa', '.jar',
    '.dmg', '.iso',
    '.compx', '.compx.enc',
    '.cimg', '.cvid'
  ]);

  const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.avif']);
  const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.m4v', '.ogv']);
  const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/tiff', 'image/avif']);
  const VIDEO_MIMES = new Set(['video/mp4', 'video/webm', 'video/avi', 'video/quicktime', 'video/x-matroska', 'video/x-flv', 'video/x-ms-wmv', 'video/ogg']);

  function isCompressedFileType(filename) {
    const lower = filename.toLowerCase();
    for (const ext of COMPRESSED_EXTENSIONS) {
      if (lower.endsWith(ext)) return true;
    }
    return false;
  }

  // --- DOM References ---
  const dropZone = $('#dropZone');
  const fileInput = $('#fileInput');
  const browseBtn = $('#browseBtn');
  const fileControls = $('#fileControls');
  const uploadSection = $('#uploadSection');
  const fileName = $('#fileName');
  const fileSize = $('#fileSize');
  const clearFileBtn = $('#clearFile');
  const compressBtn = $('#compressBtn');
  const decompressBtn = $('#decompressBtn');
  const progressSection = $('#progressSection');
  const progressBar = $('#progressBar');
  const progressPercent = $('#progressPercent');
  const progressLabel = $('#progressLabel');
  const resultsSection = $('#resultsSection');
  const downloadBtn = $('#downloadBtn');
  const sendToRoomBtn = $('#sendToRoomBtn');
  const newFileBtn = $('#newFileBtn');
  const chartContainer = $('#chartContainer');
  const freqChart = $('#freqChart');
  const activitySection = $('#activitySection');
  const activityFeed = $('#activityFeed');
  const sidebar = $('#sidebar');
  const collapseCollab = $('#collapseCollab');

  const roomJoinUI = $('#roomJoinUI');
  const roomActiveUI = $('#roomActiveUI');
  const nameInput = $('#nameInput');
  const createRoomBtn = $('#createRoomBtn');
  const roomCodeInput = $('#roomCodeInput');
  const joinRoomBtn = $('#joinRoomBtn');
  const roomCodeDisplay = $('#roomCodeDisplay');
  const copyCodeBtn = $('#copyCodeBtn');
  const leaveRoomBtn = $('#leaveRoomBtn');
  const membersList = $('#membersList');
  const chatMessages = $('#chatMessages');
  const chatInput = $('#chatInput');
  const sendChatBtn = $('#sendChatBtn');

  const connectionStatus = $('#connectionStatus');

  // Encryption
  const encryptToggle = $('#encryptToggle');
  const passwordField = $('#passwordField');
  const passwordInput = $('#passwordInput');
  const togglePasswordBtn = $('#togglePassword');
  const encryptionBadge = $('#encryptionBadge');

  // Decrypt prompt
  const decryptPrompt = $('#decryptPrompt');
  const decryptPasswordInput = $('#decryptPasswordInput');
  const decryptSubmitBtn = $('#decryptSubmitBtn');
  const decryptCancelBtn = $('#decryptCancelBtn');

  // File warning
  const fileWarning = $('#fileWarning');
  const fileWarningText = $('#fileWarningText');

  // Transfer
  const transferSection = $('#transferSection');
  const transferTitle = $('#transferTitle');
  const transferMeta = $('#transferMeta');
  const transferProgress = $('#transferProgress');
  const transferActions = $('#transferActions');
  const transferDownloadBtn = $('#transferDownloadBtn');
  const transferDismissBtn = $('#transferDismissBtn');

  // Media controls
  const mediaControls = $('#mediaControls');
  const mediaFileName = $('#mediaFileName');
  const mediaFileSize = $('#mediaFileSize');
  const clearMediaFile = $('#clearMediaFile');
  const qualitySlider = $('#qualitySlider');
  const qualityValue = $('#qualityValue');
  const videoSettings = $('#videoSettings');
  const mediaCompressBtn = $('#mediaCompressBtn');
  const mediaDecompressBtn = $('#mediaDecompressBtn');
  const mediaPreview = $('#mediaPreview');
  const previewCanvas = $('#previewCanvas');
  const algoInfoText = $('#algoInfoText');
  const mediaResultPreview = $('#mediaResultPreview');
  const resultPreviewCanvas = $('#resultPreviewCanvas');
  const videoPlayback = $('#videoPlayback');
  const playVideoBtn = $('#playVideoBtn');
  const videoFrameInfo = $('#videoFrameInfo');

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatTime(ms) {
    if (ms < 1000) return ms + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }

  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }

  // --- Encryption UI ---
  encryptToggle.addEventListener('change', () => {
    if (encryptToggle.checked) {
      show(passwordField);
      passwordInput.focus();
    } else {
      hide(passwordField);
      passwordInput.value = '';
    }
  });

  togglePasswordBtn.addEventListener('click', () => {
    const type = passwordInput.type === 'password' ? 'text' : 'password';
    passwordInput.type = type;
  });

  // --- File Handling ---
  function handleFile(file) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      alert('File too large. Max size is 50 MB.');
      return;
    }

    // Detect media type
    const ext = getExtension(file.name).toLowerCase();
    const mime = file.type.toLowerCase();

    if (file.name.endsWith('.cimg')) {
      mediaType = 'image-decompress';
    } else if (file.name.endsWith('.cvid')) {
      mediaType = 'video-decompress';
    } else if (IMAGE_MIMES.has(mime) || IMAGE_EXTENSIONS.has(ext)) {
      mediaType = 'image';
    } else if (VIDEO_MIMES.has(mime) || VIDEO_EXTENSIONS.has(ext)) {
      mediaType = 'video';
    } else {
      mediaType = null;
    }

    const reader = new FileReader();
    reader.onload = () => {
      currentFile = { file, buffer: reader.result };

      if (mediaType) {
        showMediaFileInfo(file);
      } else {
        showFileInfo(file);
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function showMediaFileInfo(file) {
    mediaFileName.textContent = file.name;
    mediaFileSize.textContent = formatBytes(file.size);

    hide(uploadSection);
    hide(fileControls);
    hide(resultsSection);
    hide(progressSection);
    show(mediaControls);

    const isDecomp = mediaType === 'image-decompress' || mediaType === 'video-decompress';

    if (isDecomp) {
      hide(mediaCompressBtn);
      show(mediaDecompressBtn);
      hide(qualitySlider.closest('.media-setting-group'));
      hide(videoSettings);
      algoInfoText.textContent = mediaType === 'image-decompress'
        ? 'Decompress .cimg → Huffman → RLE → IDCT → Image'
        : 'Decompress .cvid → Reconstruct I/P-Frames → Video';
    } else {
      show(mediaCompressBtn);
      hide(mediaDecompressBtn);
      show(qualitySlider.closest('.media-setting-group'));

      if (mediaType === 'video') {
        show(videoSettings);
        algoInfoText.textContent = 'I/P-Frame + DCT → Quantization → Zigzag → RLE → Huffman';
      } else {
        hide(videoSettings);
        algoInfoText.textContent = 'DCT → Quantization → Zigzag → RLE → Huffman';
      }

      // Show image preview
      if (mediaType === 'image') {
        showImagePreview(file);
      }
    }
  }

  function showImagePreview(file) {
    const img = new Image();
    img.onload = () => {
      previewCanvas.width = img.width;
      previewCanvas.height = img.height;
      const ctx = previewCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      show(mediaPreview);
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  function showFileInfo(file) {
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);

    show(fileControls);
    hide(uploadSection);
    hide(resultsSection);
    hide(progressSection);
    hide(decryptPrompt);
    hide(mediaControls);

    const isCompx = file.name.endsWith('.compx');
    const isCompxEnc = file.name.endsWith('.compx.enc');
    const isDecompressable = isCompx || isCompxEnc;

    compressBtn.disabled = isDecompressable;
    decompressBtn.disabled = !isDecompressable;

    // Show/hide encryption controls for compression
    if (isDecompressable) {
      hide($('#encryptionControls'));
      hide($('.algo-selector'));
    } else {
      show($('#encryptionControls'));
      show($('.algo-selector'));
    }

    // Check if file type is already compressed
    if (!isDecompressable && isCompressedFileType(file.name)) {
      fileWarningText.textContent = `"${getExtension(file.name)}" files are already compressed. Compression may increase file size, but you can still add encryption.`;
      show(fileWarning);
    } else {
      hide(fileWarning);
    }
  }

  function getExtension(filename) {
    const idx = filename.lastIndexOf('.');
    if (idx < 0) return '';
    return filename.substring(idx);
  }

  function resetUI() {
    currentFile = null;
    resultBuffer = null;
    resultFilename = null;
    resultEncrypted = false;
    mediaType = null;
    decompressedVideoFrames = null;
    if (videoPlayInterval) { clearInterval(videoPlayInterval); videoPlayInterval = null; }
    if (mediaWorker) { mediaWorker.terminate(); mediaWorker = null; }
    hide(fileControls);
    hide(mediaControls);
    hide(mediaPreview);
    hide(mediaResultPreview);
    hide(videoPlayback);
    show(uploadSection);
    hide(resultsSection);
    hide(progressSection);
    hide(fileWarning);
    hide(decryptPrompt);
    fileInput.value = '';

    // Reset encryption state
    encryptToggle.checked = false;
    hide(passwordField);
    passwordInput.value = '';
  }

  dropZone.addEventListener('click', () => fileInput.click());
  browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  clearFileBtn.addEventListener('click', resetUI);
  clearMediaFile.addEventListener('click', resetUI);
  newFileBtn.addEventListener('click', resetUI);

  function getSelectedAlgorithm() {
    const checked = document.querySelector('input[name="algo"]:checked');
    return parseInt(checked.value, 10);
  }

  // --- Compression / Decompression ---
  function runWorker(action, password) {
    if (!currentFile) return;

    show(progressSection);
    hide(resultsSection);
    hide(decryptPrompt);
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';

    const isEncrypting = action === 'compress' && encryptToggle.checked;
    const actionLabel = action === 'compress'
      ? (isEncrypting ? 'Compressing & Encrypting...' : 'Compressing...')
      : (password ? 'Decrypting & Decompressing...' : 'Decompressing...');
    progressLabel.textContent = actionLabel;
    compressBtn.disabled = true;
    decompressBtn.disabled = true;

    if (ws.roomCode && action === 'compress') {
      const algoNames = ['Huffman', 'LZ77', 'Combined'];
      ws.shareCompressing(currentFile.file.name, currentFile.file.size, algoNames[getSelectedAlgorithm()]);
    }

    if (worker) worker.terminate();
    worker = new Worker('workers/compression.worker.js');

    worker.onmessage = (e) => {
      const msg = e.data;

      if (msg.type === 'progress') {
        const pct = Math.round(msg.value * 100);
        // Throttle progress DOM updates via rAF to reduce layout thrashing.
        // Only schedule if not already pending and value actually changed.
        if (!progressRAF && pct !== lastProgressPct) {
          lastProgressPct = pct;
          progressRAF = requestAnimationFrame(() => {
            progressBar.style.width = lastProgressPct + '%';
            progressPercent.textContent = lastProgressPct + '%';
            progressRAF = null;
          });
        } else {
          lastProgressPct = pct;
        }
      }

      if (msg.type === 'result') {
        resultBuffer = msg.buffer;
        resultFilename = msg.filename;
        resultEncrypted = !!(msg.stats && msg.stats.encrypted);
        showResults(msg.stats, action);

        if (ws.roomCode) {
          ws.shareResult(msg.stats);
        }

        worker.terminate();
        worker = null;
      }

      if (msg.type === 'need_password') {
        // File is encrypted, show password prompt
        hide(progressSection);
        show(decryptPrompt);
        decryptPasswordInput.focus();
        compressBtn.disabled = false;
        decompressBtn.disabled = false;
        worker.terminate();
        worker = null;
      }

      if (msg.type === 'error') {
        alert('Error: ' + msg.message);
        hide(progressSection);
        compressBtn.disabled = false;
        decompressBtn.disabled = false;
        worker.terminate();
        worker = null;
      }
    };

    const bufferCopy = currentFile.buffer.slice(0);
    const workerMsg = {
      action,
      buffer: bufferCopy,
      filename: currentFile.file.name,
      mode: getSelectedAlgorithm(),
      encrypted: isEncrypting,
      password: password || (isEncrypting ? passwordInput.value : null)
    };
    worker.postMessage(workerMsg, [bufferCopy]);
  }

  compressBtn.addEventListener('click', () => {
    if (encryptToggle.checked && !passwordInput.value.trim()) {
      passwordInput.focus();
      passwordInput.style.borderColor = 'var(--danger)';
      setTimeout(() => { passwordInput.style.borderColor = ''; }, 2000);
      return;
    }
    runWorker('compress');
  });

  decompressBtn.addEventListener('click', () => {
    runWorker('decompress');
  });

  // Decrypt prompt handlers
  decryptSubmitBtn.addEventListener('click', () => {
    const pw = decryptPasswordInput.value;
    if (!pw) {
      decryptPasswordInput.focus();
      decryptPasswordInput.style.borderColor = 'var(--danger)';
      setTimeout(() => { decryptPasswordInput.style.borderColor = ''; }, 2000);
      return;
    }
    hide(decryptPrompt);
    runWorker('decompress', pw);
  });

  decryptPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') decryptSubmitBtn.click();
  });

  decryptCancelBtn.addEventListener('click', () => {
    hide(decryptPrompt);
    decryptPasswordInput.value = '';
  });

  // --- Results ---
  function showResults(stats, action) {
    hide(progressSection);
    show(resultsSection);

    $('#statOriginal').textContent = formatBytes(stats.originalSize);
    $('#statCompressed').textContent = formatBytes(stats.compressedSize);
    $('#statRatio').textContent = (stats.ratio > 0 ? stats.ratio : '0') + '%';
    $('#statTime').textContent = formatTime(parseFloat(stats.time));
    $('#statSpeed').textContent = stats.speed ? stats.speed + ' MB/s' : '—';
    $('#statAlgo').textContent = stats.algorithm || stats.mode || '—';

    // Encryption badge
    if (stats.encrypted) {
      show(encryptionBadge);
    } else {
      hide(encryptionBadge);
    }

    if (stats.frequencyTable) {
      show(chartContainer);
      drawFrequencyChart(stats.frequencyTable);
    } else {
      hide(chartContainer);
    }

    // Show "Send to Room" if in a room
    if (ws.roomCode && resultBuffer) {
      show(sendToRoomBtn);
    } else {
      hide(sendToRoomBtn);
    }
  }

  function drawFrequencyChart(freqTable) {
    const canvas = freqChart;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const padding = { top: 10, right: 10, bottom: 24, left: 10 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    ctx.clearRect(0, 0, w, h);

    const maxFreq = Math.max(...freqTable, 1);
    const barW = chartW / 256;

    for (let i = 0; i < 256; i++) {
      if (freqTable[i] === 0) continue;
      const barH = (freqTable[i] / maxFreq) * chartH;
      const x = padding.left + i * barW;
      const y = padding.top + chartH - barH;

      const intensity = freqTable[i] / maxFreq;
      const r = Math.round(108 + (0 - 108) * intensity);
      const g = Math.round(92 + (206 - 92) * intensity);
      const b = Math.round(231 + (201 - 231) * intensity);
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x, y, Math.max(barW - 0.5, 1), barH);
    }

    ctx.fillStyle = '#565b73';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('0', padding.left, h - 6);
    ctx.textAlign = 'center';
    ctx.fillText('128', padding.left + chartW / 2, h - 6);
    ctx.textAlign = 'right';
    ctx.fillText('255', w - padding.right, h - 6);
    ctx.textAlign = 'center';
    ctx.fillText('Byte Value', w / 2, h - 1);
  }

  downloadBtn.addEventListener('click', () => {
    if (!resultBuffer) return;
    const blob = new Blob([resultBuffer]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resultFilename || 'output.compx';
    a.click();
    URL.revokeObjectURL(url);
  });

  // --- Send to Room ---
  sendToRoomBtn.addEventListener('click', async () => {
    if (!ws.roomCode || !resultBuffer) return;

    sendToRoomBtn.disabled = true;
    sendToRoomBtn.textContent = 'Sending...';

    try {
      const fileData = new Uint8Array(resultBuffer);
      await ws.sendFile(fileData, resultFilename, resultEncrypted, (progress) => {
        sendToRoomBtn.textContent = `Sending ${Math.round(progress * 100)}%...`;
      });
      sendToRoomBtn.textContent = 'Sent ✓';
      setTimeout(() => {
        sendToRoomBtn.disabled = false;
        sendToRoomBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Send to Room`;
      }, 2000);
    } catch (err) {
      alert('Transfer error: ' + err.message);
      sendToRoomBtn.disabled = false;
      sendToRoomBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Send to Room`;
    }
  });

  // --- WebSocket Events ---
  ws.on('connected', () => {
    connectionStatus.className = 'connection-status connected';
    connectionStatus.querySelector('.status-text').textContent = 'Connected';
  });

  ws.on('disconnected', () => {
    connectionStatus.className = 'connection-status';
    connectionStatus.querySelector('.status-text').textContent = 'Reconnecting...';
  });

  ws.on('reconnect_failed', () => {
    connectionStatus.querySelector('.status-text').textContent = 'Offline';
  });

  ws.on('room:created', (msg) => {
    enterRoom(msg.roomCode, msg.users);
  });

  ws.on('room:joined', (msg) => {
    enterRoom(msg.roomCode, msg.users);
  });

  ws.on('room:left', () => {
    exitRoom();
  });

  ws.on('room:error', (msg) => {
    alert(msg.message);
  });

  ws.on('user:joined', (msg) => {
    updateMembers(msg.users);
    addChatSystem(msg.user.name + ' joined');
  });

  ws.on('user:left', (msg) => {
    updateMembers(msg.users);
    addChatSystem(msg.userName + ' left');
  });

  ws.on('file:compressing', (msg) => {
    addActivity(msg.userName, `is compressing <strong>${escapeHtml(msg.fileName)}</strong>`, msg.userId);
  });

  ws.on('file:result', (msg) => {
    const s = msg.stats;
    const detail = `${formatBytes(s.originalSize)} → ${formatBytes(s.compressedSize)} (${s.ratio}% saved) • ${s.mode || s.algorithm}`;
    addActivity(msg.userName, `finished compression`, msg.userId, detail);
  });

  ws.on('chat:message', (msg) => {
    addChatMessage(msg.userName, msg.text, msg.userColor, msg.self);
  });

  // --- File Transfer Events ---
  ws.on('file:transfer:start', (msg) => {
    show(transferSection);
    hide(transferActions);
    transferTitle.textContent = `Receiving file from ${escapeHtml(msg.userName)}...`;
    transferMeta.textContent = `${escapeHtml(msg.fileName)} • ${formatBytes(msg.fileSize)}${msg.encrypted ? ' • Encrypted' : ''}`;
    transferProgress.style.width = '0%';
    receivedFileData = null;

    addActivity(msg.userName, `is sending <strong>${escapeHtml(msg.fileName)}</strong>`, msg.userId);
  });

  ws.on('file:transfer:progress', (msg) => {
    const pct = Math.round((msg.received / msg.total) * 100);
    transferProgress.style.width = pct + '%';
    transferTitle.textContent = `Receiving file... ${pct}%`;
  });

  ws.on('file:transfer:complete', (msg) => {
    transferTitle.textContent = `File received from ${escapeHtml(msg.userName)}`;
    transferMeta.textContent = `${escapeHtml(msg.fileName)} • ${formatBytes(msg.fileSize)}${msg.encrypted ? ' • Encrypted' : ''}`;
    transferProgress.style.width = '100%';
    show(transferActions);

    receivedFileData = { data: msg.data, fileName: msg.fileName };

    addActivity(msg.userName, `sent <strong>${escapeHtml(msg.fileName)}</strong> (${formatBytes(msg.fileSize)})`, null);
    addChatSystem(`📁 ${msg.userName} sent ${msg.fileName}`);
  });

  ws.on('file:transfer:error', (msg) => {
    transferTitle.textContent = 'Transfer failed';
    transferMeta.textContent = msg.message;
    setTimeout(() => hide(transferSection), 5000);
  });

  transferDownloadBtn.addEventListener('click', () => {
    if (!receivedFileData) return;
    const blob = new Blob([receivedFileData.data]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = receivedFileData.fileName;
    a.click();
    URL.revokeObjectURL(url);
  });

  transferDismissBtn.addEventListener('click', () => {
    hide(transferSection);
    receivedFileData = null;
  });

  // --- Room UI ---
  createRoomBtn.addEventListener('click', () => {
    ws.createRoom(nameInput.value.trim() || undefined);
  });

  joinRoomBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim();
    if (!code) return;
    ws.joinRoom(code, nameInput.value.trim() || undefined);
  });

  roomCodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoomBtn.click();
  });

  leaveRoomBtn.addEventListener('click', () => {
    ws.leaveRoom();
    exitRoom();
  });

  copyCodeBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(ws.roomCode).then(() => {
      copyCodeBtn.textContent = 'Copied!';
      setTimeout(() => { copyCodeBtn.textContent = 'Copy'; }, 1500);
    });
  });

  sendChatBtn.addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChat();
  });

  function sendChat() {
    const text = chatInput.value.trim();
    if (!text) return;
    ws.sendChat(text);
    chatInput.value = '';
  }

  function enterRoom(code, users) {
    hide(roomJoinUI);
    show(roomActiveUI);
    roomCodeDisplay.textContent = code;
    updateMembers(users);
    show(activitySection);
    addChatSystem('You joined room ' + code);

    // Show send-to-room button if there's a result
    if (resultBuffer) {
      show(sendToRoomBtn);
    }
  }

  function exitRoom() {
    show(roomJoinUI);
    hide(roomActiveUI);
    hide(activitySection);
    hide(sendToRoomBtn);
    hide(transferSection);
    membersList.innerHTML = '';
    chatMessages.innerHTML = '';
    activityFeed.innerHTML = '';
    receivedFileData = null;
  }

  function updateMembers(users) {
    membersList.innerHTML = '';
    (users || []).forEach(u => {
      const el = document.createElement('div');
      el.className = 'member-item';
      el.innerHTML = `<span class="member-dot" style="background:${u.color}"></span>${escapeHtml(u.name)}`;
      membersList.appendChild(el);
    });
  }

  function addChatSystem(text) {
    const el = document.createElement('div');
    el.className = 'chat-msg system';
    el.textContent = text;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addChatMessage(name, text, color, isSelf) {
    const el = document.createElement('div');
    el.className = 'chat-msg';
    el.innerHTML = `<span class="chat-author" style="color:${color}">${escapeHtml(name)}</span>${escapeHtml(text)}`;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function addActivity(userName, action, userId, detail) {
    show(activitySection);
    const el = document.createElement('div');
    el.className = 'activity-item';
    el.innerHTML = `
      <span class="activity-dot" style="background:var(--accent)"></span>
      <div class="activity-content">
        <span class="activity-user">${escapeHtml(userName)}</span> ${action}
        ${detail ? `<div class="activity-detail">${escapeHtml(detail)}</div>` : ''}
      </div>
    `;
    activityFeed.prepend(el);

    while (activityFeed.children.length > 20) {
      activityFeed.removeChild(activityFeed.lastChild);
    }
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  collapseCollab.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    if (window.innerWidth <= 900) {
      sidebar.classList.toggle('mobile-open');
    }
  });

  // ═══════════════════════════════════════════════════
  // MEDIA COMPRESSION / DECOMPRESSION
  // ═══════════════════════════════════════════════════

  // Quality slider
  qualitySlider.addEventListener('input', () => {
    qualityValue.textContent = qualitySlider.value;
  });

  // --- Image Compression ---
  mediaCompressBtn.addEventListener('click', () => {
    if (!currentFile) return;

    if (mediaType === 'image') {
      compressImage();
    } else if (mediaType === 'video') {
      compressVideo();
    }
  });

  function compressImage() {
    const quality = parseInt(qualitySlider.value, 10);
    const file = currentFile.file;

    show(progressSection);
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    progressLabel.textContent = 'Compressing image (DCT)...';

    // Load image pixels via Canvas (I/O only)
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      URL.revokeObjectURL(img.src);

      // Run compression in worker
      if (mediaWorker) mediaWorker.terminate();
      mediaWorker = new Worker('workers/media.worker.js');

      mediaWorker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          const pct = Math.round(msg.value * 100);
          progressBar.style.width = pct + '%';
          progressPercent.textContent = pct + '%';
        }
        if (msg.type === 'result') {
          resultBuffer = msg.buffer;
          resultFilename = msg.filename;
          resultEncrypted = false;
          showResults(msg.stats, 'compress');
          mediaWorker.terminate();
          mediaWorker = null;
        }
        if (msg.type === 'error') {
          alert('Image compression error: ' + msg.message);
          hide(progressSection);
          show(mediaControls);
          mediaWorker.terminate();
          mediaWorker = null;
        }
      };

      const pixelBuffer = imageData.data.buffer.slice(0);
      mediaWorker.postMessage({
        action: 'compress-image',
        data: {
          pixels: pixelBuffer,
          width: img.width,
          height: img.height,
          quality,
          filename: file.name
        }
      }, [pixelBuffer]);
    };
    img.src = URL.createObjectURL(file);
  }

  // --- Video Compression ---
  function compressVideo() {
    const quality = parseInt(qualitySlider.value, 10);
    const fps = parseInt($('#videoFps').value, 10);
    const maxRes = parseInt($('#videoResolution').value, 10);
    const gopInterval = parseInt($('#gopInterval').value, 10);
    const maxFrames = parseInt($('#maxFrames').value, 10);
    const file = currentFile.file;

    show(progressSection);
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    progressLabel.textContent = 'Extracting frames...';

    // Extract frames in main thread (needs DOM)
    VideoCompressor.extractFrames(file, {
      fps,
      maxWidth: maxRes * (16/9),
      maxHeight: maxRes,
      maxFrames
    }, (p) => {
      const pct = Math.round(p * 30);
      progressBar.style.width = pct + '%';
      progressPercent.textContent = pct + '%';
    }).then((frameData) => {
      progressLabel.textContent = 'Compressing video (I/P-frames + DCT)...';

      // Send frames to worker for compression
      if (mediaWorker) mediaWorker.terminate();
      mediaWorker = new Worker('workers/media.worker.js');

      mediaWorker.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'progress') {
          const pct = Math.round(msg.value * 100);
          progressBar.style.width = pct + '%';
          progressPercent.textContent = pct + '%';
        }
        if (msg.type === 'result') {
          resultBuffer = msg.buffer;
          resultFilename = msg.filename;
          resultEncrypted = false;
          showResults(msg.stats, 'compress');
          mediaWorker.terminate();
          mediaWorker = null;
        }
        if (msg.type === 'error') {
          alert('Video compression error: ' + msg.message);
          hide(progressSection);
          show(mediaControls);
          mediaWorker.terminate();
          mediaWorker = null;
        }
      };

      // Transfer frame buffers to worker
      const frameBuffers = frameData.frames.map(f => f.buffer.slice(0));
      const transfers = frameBuffers.map(b => b);

      mediaWorker.postMessage({
        action: 'compress-video-frames',
        data: {
          frames: frameBuffers,
          width: frameData.width,
          height: frameData.height,
          fps: frameData.fps,
          quality,
          gopInterval,
          filename: file.name
        }
      }, transfers);
    }).catch((err) => {
      alert('Video error: ' + err.message);
      hide(progressSection);
      show(mediaControls);
    });
  }

  // --- Media Decompression ---
  mediaDecompressBtn.addEventListener('click', () => {
    if (!currentFile) return;

    if (mediaType === 'image-decompress') {
      decompressImage();
    } else if (mediaType === 'video-decompress') {
      decompressVideo();
    }
  });

  function decompressImage() {
    show(progressSection);
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    progressLabel.textContent = 'Decompressing image...';

    if (mediaWorker) mediaWorker.terminate();
    mediaWorker = new Worker('workers/media.worker.js');

    mediaWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        const pct = Math.round(msg.value * 100);
        progressBar.style.width = pct + '%';
        progressPercent.textContent = pct + '%';
      }
      if (msg.type === 'result') {
        // Show decompressed image in preview
        const pixels = new Uint8ClampedArray(msg.pixels);
        const w = msg.width;
        const h = msg.height;

        resultPreviewCanvas.width = w;
        resultPreviewCanvas.height = h;
        const ctx = resultPreviewCanvas.getContext('2d');
        const imgData = new ImageData(pixels, w, h);
        ctx.putImageData(imgData, 0, 0);

        // Create downloadable PNG
        resultPreviewCanvas.toBlob((blob) => {
          resultBuffer = null;
          resultFilename = msg.filename;
          resultEncrypted = false;

          // Store blob for download
          const reader = new FileReader();
          reader.onload = () => {
            resultBuffer = reader.result;
            showResults(msg.stats, 'decompress');
            show(mediaResultPreview);
          };
          reader.readAsArrayBuffer(blob);
        }, 'image/png');

        mediaWorker.terminate();
        mediaWorker = null;
      }
      if (msg.type === 'error') {
        alert('Image decompression error: ' + msg.message);
        hide(progressSection);
        show(mediaControls);
        mediaWorker.terminate();
        mediaWorker = null;
      }
    };

    const bufferCopy = currentFile.buffer.slice(0);
    mediaWorker.postMessage({
      action: 'decompress-image',
      data: { buffer: bufferCopy, filename: currentFile.file.name }
    }, [bufferCopy]);
  }

  function decompressVideo() {
    show(progressSection);
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    progressLabel.textContent = 'Decompressing video...';

    // Run in worker to avoid blocking the main thread (Bug #5 fix)
    if (mediaWorker) mediaWorker.terminate();
    mediaWorker = new Worker('workers/media.worker.js');

    mediaWorker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        const pct = Math.round(msg.value * 100);
        progressBar.style.width = pct + '%';
        progressPercent.textContent = pct + '%';
      }
      if (msg.type === 'result') {
        // Reconstruct frames from transferred buffers
        const frames = msg.frames.map(buf => new Uint8ClampedArray(buf));
        decompressedVideoFrames = {
          frames,
          width: msg.width,
          height: msg.height,
          fps: msg.fps
        };

        // Show first frame in preview
        if (frames.length > 0) {
          resultPreviewCanvas.width = msg.width;
          resultPreviewCanvas.height = msg.height;
          const ctx = resultPreviewCanvas.getContext('2d');
          const imgData = new ImageData(frames[0], msg.width, msg.height);
          ctx.putImageData(imgData, 0, 0);
        }

        show(mediaResultPreview);
        show(videoPlayback);
        videoFrameInfo.textContent = `${frames.length} frames @ ${msg.fps}fps`;

        resultBuffer = currentFile.buffer;
        resultFilename = currentFile.file.name.replace(/\.cvid$/, '_frames.cvid');
        showResults(msg.stats, 'decompress');

        mediaWorker.terminate();
        mediaWorker = null;
      }
      if (msg.type === 'error') {
        alert('Video decompression error: ' + msg.message);
        hide(progressSection);
        show(mediaControls);
        mediaWorker.terminate();
        mediaWorker = null;
      }
    };

    const bufferCopy = currentFile.buffer.slice(0);
    mediaWorker.postMessage({
      action: 'decompress-video',
      data: { buffer: bufferCopy, filename: currentFile.file.name }
    }, [bufferCopy]);
  }

  // Video playback
  playVideoBtn.addEventListener('click', () => {
    if (!decompressedVideoFrames || !decompressedVideoFrames.frames.length) return;

    const { frames, width, height, fps } = decompressedVideoFrames;
    const ctx = resultPreviewCanvas.getContext('2d');
    let frameIdx = 0;

    if (videoPlayInterval) {
      clearInterval(videoPlayInterval);
      videoPlayInterval = null;
      playVideoBtn.querySelector('svg').innerHTML = '<polygon points="5 3 19 12 5 21 5 3"/>';
      return;
    }

    playVideoBtn.querySelector('svg').innerHTML = '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';

    videoPlayInterval = setInterval(() => {
      if (frameIdx >= frames.length) {
        frameIdx = 0; // Loop
      }
      const imgData = new ImageData(new Uint8ClampedArray(frames[frameIdx]), width, height);
      ctx.putImageData(imgData, 0, 0);
      videoFrameInfo.textContent = `Frame ${frameIdx + 1}/${frames.length} @ ${fps}fps`;
      frameIdx++;
    }, 1000 / fps);
  });

  ws.connect();

})();
