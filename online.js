/* Transport only: the room server owns online game state. */
(() => {
  'use strict';
  const SESSION_KEY = 'flotta.online.session.v1';
  async function requestJSON(url, options = {}, timeout = 10000) {
    // AbortController also works on iPads predating AbortSignal.timeout.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      return { response, data: await response.json() };
    } finally { clearTimeout(timer); }
  }
  class FlottaOnline {
    constructor({ onState, onStatus }) {
      this.onState = onState;
      this.onStatus = onStatus;
      this.available = false;
      this.maxHumans = 2;
      this.active = false;
      this.connected = false;
      this.busy = false;
      this.message = '';
      this.waiting = false;
      this.session = null;
      this.socket = null;
      this.generation = 0;
      this.retry = 0;
      this.failures = 0;
      this.lastState = null;
      this.lobby = null;
      this.roomCode = '';
      this.stored = this.readSession();
      window.addEventListener('online', () => { if (this.active && !this.connected) this.connect(); });
      document.addEventListener('visibilitychange', () => {
        // iPad Safari can suspend a socket without reporting that it closed.
        if (document.visibilityState === 'visible' && this.active) this.connect();
      });
    }

    readSession() {
      try {
        const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
        if (saved && /^[A-HJ-NP-Z2-9]{8}$/.test(saved.code) && /^[a-f0-9-]{72}$/.test(saved.token)
            && [0, 1, 2, 3].includes(saved.seat) && typeof saved.endpoint === 'string') return saved;
      } catch {}
      return null;
    }

    async init() {
      try {
        const local = ['localhost', '127.0.0.1'].includes(location.hostname);
        const configured = local ? location.origin : window.FLOTTA_ONLINE_URL || location.origin;
        const endpoint = new URL(configured);
        if (endpoint.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(endpoint.hostname)) return;
        const { response, data: info } = await requestJSON(endpoint.origin + '/api/info', { cache: 'no-store' }, 6000);
        if (!response.ok || !info.multiplayer || info.version !== 1) return;
        this.endpoint = endpoint.origin;
        this.available = true;
        this.maxHumans = info.maxHumans === 4 ? 4 : 2;
        if (this.stored?.endpoint !== this.endpoint) this.stored = null;
        this.onStatus();
      } catch { /* Local play remains available when the service cannot be reached. */ }
    }

    async enter(kind, options) {
      if (this.busy || !this.available) return;
      this.busy = true;
      this.message = '';
      this.onStatus();
      try {
        // Refuse to create a room if this browser cannot retain its private seat.
        localStorage.setItem(SESSION_KEY + '.check', '0'.repeat(1024));
        localStorage.removeItem(SESSION_KEY + '.check');
        const path = kind === 'create' ? '/api/rooms' : `/api/rooms/${options.code}/join`;
        const { response, data: result } = await requestJSON(this.endpoint + path, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options),
        }, 15000);
        if (!response.ok) throw new Error(result.error || 'Could not open that room.');
        this.session = { endpoint: this.endpoint, code: result.code, seat: result.seat, token: result.token };
        localStorage.setItem(SESSION_KEY, JSON.stringify(this.session));
        this.stored = this.session;
        this.active = true;
        this.waiting = true;
        this.lastState = null;
        this.lobby = null;
        this.roomCode = result.code;
        this.connect();
      } catch (error) {
        this.message = error.name === 'QuotaExceededError' || error.name === 'SecurityError'
          ? 'Allow browser storage to keep your private place in this room.'
          : error.name === 'AbortError' ? 'Could not reach the room service. Please try again.' : error.message;
      } finally { this.busy = false; this.onStatus(); }
    }

    resume() {
      if (!this.stored || this.active) return;
      this.session = this.stored;
      this.roomCode = this.session.code;
      this.active = true;
      this.waiting = true;
      this.lastState = null;
      this.lobby = null;
      this.message = '';
      this.connect();
      this.onStatus();
    }

    connect() {
      if (!this.active || !this.session) return;
      clearTimeout(this.retry);
      clearTimeout(this.commandTimeout);
      const generation = ++this.generation;
      this.socket?.close();
      this.connected = false;
      this.busy = false;
      const url = new URL(`/api/rooms/${this.session.code}/socket`, this.session.endpoint);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = this.socket = new WebSocket(url, ['flotta-v1', `auth.${this.session.token}`]);
      socket.addEventListener('open', () => {
        if (generation !== this.generation) return;
        // Wait for the authoritative snapshot before enabling actions.
        this.message = '';
      });
      socket.addEventListener('message', event => {
        if (generation !== this.generation) return;
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'error') { this.message = data.error; this.onStatus(); return; }
        if (data.type !== 'state' || data.seat !== this.session.seat) return;
        this.connected = true;
        this.failures = 0;
        this.busy = false;
        this.waiting = data.waiting;
        this.lobby = data.lobby ?? null;
        this.lastState = data.state;
        clearTimeout(this.commandTimeout);
        this.onState(data.state);
      });
      socket.addEventListener('close', event => {
        if (generation !== this.generation || !this.active) return;
        this.connected = false;
        this.busy = false;
        clearTimeout(this.commandTimeout);
        if (event.code === 4001) {
          this.message = 'This player is open in another tab. Close that tab, then tap Reconnect here.';
          this.onStatus();
          return;
        }
        this.failures++;
        if (this.failures >= 8) {
          this.message = 'Could not reconnect. Check your connection and tap Reconnect. Rooms expire after 30 days without play.';
          this.onStatus();
          return;
        }
        this.message = 'Connection interrupted. Reconnecting… Your game is saved in the room.';
        this.onStatus();
        this.retry = setTimeout(() => this.connect(), Math.min(30000, 1000 * 2 ** this.failures));
      });
      socket.addEventListener('error', () => { /* close drives reconnects. */ });
      this.onStatus();
    }

    send(action) {
      if (!this.active || !this.connected || this.busy || this.socket?.readyState !== WebSocket.OPEN) return false;
      if (!this.lastState && !(action.type === 'start' && this.lobby?.canStart)) return false;
      this.busy = true;
      this.message = '';
      this.socket.send(JSON.stringify({ ...action, revision: this.lastState?.revision ?? 0, id: crypto.randomUUID() }));
      this.commandTimeout = setTimeout(() => {
        if (!this.active) return;
        // Never replay a turn blindly after a timeout. Reconnect to read the stored result.
        this.connect();
        this.onStatus();
      }, 8000);
      this.onStatus();
      return true;
    }

    leave() {
      this.active = false;
      this.connected = false;
      this.waiting = false;
      this.busy = false;
      ++this.generation;
      clearTimeout(this.retry);
      clearTimeout(this.commandTimeout);
      this.socket?.close();
      this.socket = null;
      this.lastState = null;
      this.lobby = null;
      this.message = '';
    }
  }
  window.FlottaOnline = FlottaOnline;
})();
