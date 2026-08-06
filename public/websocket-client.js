class WSClient {
  constructor() {
    this.ws = null;
    this.userId = null;
    this.userColor = null;
    this.roomCode = null;
    this.handlers = {};
    this.reconnectAttempts = 0;
    this.maxReconnect = 5;
    this.connected = false;

    // File transfer state
    this._incomingTransfers = new Map();
    this._transferCounter = 0;
  }

  on(event, callback) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(callback);
    return this;
  }

  _emit(event, data) {
    const cbs = this.handlers[event];
    if (cbs) cbs.forEach(cb => cb(data));
  }

  connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}`;

    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this._emit('connected');
    };

    this.ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        // Binary message = file transfer chunk
        this._handleBinaryChunk(new Uint8Array(e.data));
        return;
      }
      try {
        const msg = JSON.parse(e.data);
        this._handleMessage(msg);
      } catch {}
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._emit('disconnected');
      this._tryReconnect();
    };

    this.ws.onerror = () => {};
  }

  _tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnect) {
      this._emit('reconnect_failed');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    this.reconnectAttempts++;
    setTimeout(() => this.connect(), delay);
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendBinary(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  _handleMessage(msg) {
    switch (msg.event) {
      case 'welcome':
        this.userId = msg.userId;
        this.userColor = msg.color;
        this._emit('welcome', msg);
        break;

      case 'room:created':
        this.roomCode = msg.roomCode;
        this._emit('room:created', msg);
        break;

      case 'room:joined':
        this.roomCode = msg.roomCode;
        this._emit('room:joined', msg);
        break;

      case 'room:left':
        this.roomCode = null;
        this._emit('room:left', msg);
        break;

      case 'room:error':
        this._emit('room:error', msg);
        break;

      case 'user:joined':
        this._emit('user:joined', msg);
        break;

      case 'user:left':
        this._emit('user:left', msg);
        break;

      case 'file:compressing':
        this._emit('file:compressing', msg);
        break;

      case 'file:result':
        this._emit('file:result', msg);
        break;

      case 'file:transfer:start':
        this._startReceiving(msg);
        break;

      case 'file:transfer:end':
        this._finishReceiving(msg);
        break;

      case 'file:transfer:error':
        this._cancelReceiving(msg);
        break;

      case 'chat:message':
        this._emit('chat:message', msg);
        break;
    }
  }

  createRoom(name) {
    this.send({ event: 'room:create', name });
  }

  joinRoom(code, name) {
    this.send({ event: 'room:join', roomCode: code, name });
  }

  leaveRoom() {
    this.send({ event: 'room:leave' });
    this.roomCode = null;
  }

  shareCompressing(fileName, fileSize, algorithm) {
    this.send({ event: 'file:compressing', fileName, fileSize, algorithm });
  }

  shareResult(stats) {
    this.send({ event: 'file:result', stats });
  }

  sendChat(text) {
    this.send({ event: 'chat:message', text });
  }

  /**
   * Send a file (already compressed/encrypted Uint8Array) to room members.
   * Splits into 64KB chunks for WebSocket transmission.
   */
  async sendFile(fileData, fileName, isEncrypted, onProgress) {
    if (!this.roomCode) throw new Error('Not in a room');

    const CHUNK_SIZE = 64 * 1024; // 64 KB
    const totalChunks = Math.ceil(fileData.length / CHUNK_SIZE);
    const transferId = `${this.userId}-${++this._transferCounter}`;

    // Announce transfer start
    this.send({
      event: 'file:transfer:start',
      fileName,
      fileSize: fileData.length,
      totalChunks,
      encrypted: isEncrypted,
      transferId
    });

    // Send chunks as binary with a 36-byte header per chunk:
    // [transferId as 36 ASCII chars][chunkIndex as 4-byte uint32 BE][chunk data]
    const transferIdBytes = new TextEncoder().encode(transferId.padEnd(36).slice(0, 36));

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, fileData.length);
      const chunkData = fileData.subarray(start, end);

      // Build binary frame: [transferId:36][chunkIndex:4][data]
      const frame = new Uint8Array(36 + 4 + chunkData.length);
      frame.set(transferIdBytes, 0);
      const dv = new DataView(frame.buffer);
      dv.setUint32(36, i, false);
      frame.set(chunkData, 40);

      this.sendBinary(frame);

      if (onProgress) {
        onProgress((i + 1) / totalChunks);
      }

      // Small delay between chunks to avoid overwhelming the connection
      if (i < totalChunks - 1) {
        await new Promise(r => setTimeout(r, 5));
      }
    }

    // Announce transfer complete
    this.send({
      event: 'file:transfer:end',
      transferId
    });
  }

  // --- Receiving side ---

  _startReceiving(msg) {
    this._incomingTransfers.set(msg.transferId, {
      fileName: msg.fileName,
      fileSize: msg.fileSize,
      totalChunks: msg.totalChunks,
      encrypted: msg.encrypted,
      userName: msg.userName,
      userId: msg.userId,
      chunks: new Map(),
      receivedChunks: 0
    });

    this._emit('file:transfer:start', msg);
  }

  _handleBinaryChunk(data) {
    if (data.length < 40) return; // too small for header

    // Parse header: [transferId:36][chunkIndex:4][chunkData]
    const transferIdStr = new TextDecoder().decode(data.subarray(0, 36)).trim();
    const dv = new DataView(data.buffer, data.byteOffset + 36, 4);
    const chunkIndex = dv.getUint32(0, false);
    const chunkData = data.subarray(40);

    const transfer = this._incomingTransfers.get(transferIdStr);
    if (!transfer) return; // unknown transfer

    transfer.chunks.set(chunkIndex, chunkData);
    transfer.receivedChunks++;

    this._emit('file:transfer:progress', {
      transferId: transferIdStr,
      received: transfer.receivedChunks,
      total: transfer.totalChunks,
      fileName: transfer.fileName
    });
  }

  _finishReceiving(msg) {
    const transfer = this._incomingTransfers.get(msg.transferId);
    if (!transfer) return;

    // Reassemble chunks in order
    const totalSize = Array.from(transfer.chunks.values())
      .reduce((sum, chunk) => sum + chunk.length, 0);
    const assembled = new Uint8Array(totalSize);
    let offset = 0;

    for (let i = 0; i < transfer.totalChunks; i++) {
      const chunk = transfer.chunks.get(i);
      if (!chunk) {
        this._emit('file:transfer:error', {
          transferId: msg.transferId,
          message: `Missing chunk ${i}`
        });
        this._incomingTransfers.delete(msg.transferId);
        return;
      }
      assembled.set(chunk, offset);
      offset += chunk.length;
    }

    this._incomingTransfers.delete(msg.transferId);

    this._emit('file:transfer:complete', {
      transferId: msg.transferId,
      fileName: transfer.fileName,
      fileSize: transfer.fileSize,
      encrypted: transfer.encrypted,
      userName: transfer.userName,
      data: assembled
    });
  }

  _cancelReceiving(msg) {
    this._incomingTransfers.delete(msg.transferId);
    this._emit('file:transfer:error', {
      transferId: msg.transferId,
      message: msg.message || 'Transfer cancelled'
    });
  }
}
