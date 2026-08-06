(function () {
  'use strict';

  let currentFile = null;
  let resultBuffer = null;
  let resultFilename = null;
  let resultEncrypted = false;
  let worker = null;
  let receivedFileData = null;
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
    '.compx', '.compx.enc'
  ]);

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

    const reader = new FileReader();
    reader.onload = () => {
      currentFile = { file, buffer: reader.result };
      showFileInfo(file);
    };
    reader.readAsArrayBuffer(file);
  }

  function showFileInfo(file) {
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);

    show(fileControls);
    hide(uploadSection);
    hide(resultsSection);
    hide(progressSection);
    hide(decryptPrompt);

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
    const parts = filename.split('.');
    if (parts.length < 2) return '';
    return '.' + parts.slice(1).join('.');
  }

  function resetUI() {
    currentFile = null;
    resultBuffer = null;
    resultFilename = null;
    resultEncrypted = false;
    hide(fileControls);
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
        progressBar.style.width = pct + '%';
        progressPercent.textContent = pct + '%';
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
    $('#statAlgo').textContent = stats.mode || stats.algorithm || '—';

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

  ws.connect();

})();
