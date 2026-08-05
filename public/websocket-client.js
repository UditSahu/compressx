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

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      this._emit('connected');
    };

    this.ws.onmessage = (e) => {
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
}
