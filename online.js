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
      this.httpSync = false;
      this.transport = 'socket';
      this.fatal = false;
      this.pendingId = null;
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
        this.httpSync = info.httpSync === true;
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
      clearTimeout(this.socketTimeout);
      const generation = ++this.generation;
      this.socket?.close();
      this.socket = null;
      this.connected = false;
      this.busy = false;
      this.pendingId = null;
      this.fatal = false;
      this.failures = 0;
      this.message = '';
      if (this.transport === 'http') {
        this.pollHTTP(generation);
        this.onStatus();
        return;
      }
      const url = new URL(`/api/rooms/${this.session.code}/socket`, this.session.endpoint);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      let socket;
      try { socket = this.socket = new WebSocket(url, ['flotta-v1', `auth.${this.session.token}`]); }
      catch { this.useHTTP(generation); return; }
      // A socket may open without ever delivering the first snapshot on a
      // suspended mobile connection. HTTPS can recover the same saved seat.
      this.socketTimeout = setTimeout(() => this.useHTTP(generation), 5000);
      socket.addEventListener('message', event => {
        if (generation !== this.generation) return;
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (data.type === 'error') { this.message = data.error; this.onStatus(); return; }
        this.acceptSnapshot(data);
      });
      socket.addEventListener('close', event => {
        if (generation !== this.generation || !this.active) return;
        clearTimeout(this.socketTimeout);
        clearTimeout(this.commandTimeout);
        this.connected = false;
        this.busy = false;
        this.pendingId = null;
        if (event.code === 4001) {
          this.message = 'This player is open in another tab. Close that tab, then tap Reconnect here.';
          this.onStatus();
          return;
        }
        this.useHTTP(generation);
      });
      socket.addEventListener('error', () => { /* close or the timeout starts recovery. */ });
      this.onStatus();
    }

    acceptSnapshot(data) {
      if (data.type !== 'state' || data.seat !== this.session?.seat) return;
      const wasConnected = this.connected, wasBusy = this.busy;
      const previousRevision = this.lastState?.revision;
      const previousWaiting = this.waiting;
      const lobbyChanged = JSON.stringify(this.lobby) !== JSON.stringify(data.lobby ?? null);
      this.connected = true;
      this.fatal = false;
      this.failures = 0;
      if (!this.pendingId || data.ackId === this.pendingId
          || (!this.httpSync && data.state?.revision !== previousRevision)) {
        this.busy = false;
        this.pendingId = null;
        clearTimeout(this.commandTimeout);
      }
      clearTimeout(this.socketTimeout);
      // Overlapping HTTPS reads can finish after a newer action response.
      if (this.lastState && (!data.state || data.state.revision < this.lastState.revision)) {
        if (wasBusy !== this.busy) this.onStatus();
        return;
      }
      this.waiting = data.waiting;
      this.lobby = data.lobby ?? null;
      this.lastState = data.state;
      // Polling an unchanged board must not interrupt selecting or dragging tiles.
      if (!wasConnected || previousRevision !== data.state?.revision || previousWaiting !== data.waiting) this.onState(data.state);
      else if (wasBusy !== this.busy || (this.waiting && lobbyChanged)) this.onStatus();
    }

    useHTTP(generation) {
      if (!this.active || generation !== this.generation) return;
      clearTimeout(this.socketTimeout);
      clearTimeout(this.commandTimeout);
      if (!this.httpSync) {
        this.connected = false;
        this.message = 'Connection interrupted. Reconnecting…';
        this.onStatus();
        this.retry = setTimeout(() => this.connect(), 3000);
        return;
      }
      ++this.generation;
      this.socket?.close();
      this.socket = null;
      this.transport = 'http';
      this.connected = false;
      this.busy = false;
      this.pendingId = null;
      this.message = 'Connecting…';
      this.pollHTTP(this.generation);
      this.onStatus();
    }

    async pollHTTP(generation) {
      if (!this.active || generation !== this.generation || this.transport !== 'http') return;
      try {
        const { response, data } = await requestJSON(
          `${this.session.endpoint}/api/rooms/${this.session.code}/state`, {
            cache: 'no-store', credentials: 'omit',
            headers: { Authorization: `Bearer ${this.session.token}` },
          });
        if (!this.active || generation !== this.generation) return;
        if (!response.ok) {
          this.message = data.error || 'Could not open this saved room.';
          this.fatal = response.status === 403 || response.status === 404;
          if (this.fatal) { this.connected = false; this.onStatus(); return; }
          throw new Error(this.message);
        }
        this.message = '';
        this.acceptSnapshot(data);
      } catch {
        if (!this.active || generation !== this.generation) return;
        this.connected = false;
        this.failures++;
        this.message = this.failures >= 8 ? 'Could not connect. Check your connection, then tap Reconnect.' : 'Connection interrupted. Retrying…';
        this.onStatus();
      }
      if (this.active && generation === this.generation && this.failures < 8 && !this.fatal) {
        const delay = this.connected ? (document.visibilityState === 'hidden' ? 10000 : 2000) : Math.min(30000, 1000 * 2 ** this.failures);
        this.retry = setTimeout(() => this.pollHTTP(generation), delay);
      }
    }

    send(action) {
      if (!this.active || !this.connected || this.busy) return false;
      if (this.transport === 'socket' && this.socket?.readyState !== WebSocket.OPEN) return false;
      if (!this.lastState && !(action.type === 'start' && this.lobby?.canStart)) return false;
      const command = { ...action, revision: this.lastState?.revision ?? 0, id: crypto.randomUUID() };
      this.busy = true;
      this.pendingId = command.id;
      this.message = '';
      if (this.transport === 'http') this.sendHTTP(command, this.generation);
      else {
        try { this.socket.send(JSON.stringify(command)); }
        catch { this.useHTTP(this.generation); return false; }
      }
      this.commandTimeout = setTimeout(() => {
        if (!this.active) return;
        // Recover the stored result; never blindly resend an uncertain turn.
        if (this.transport === 'socket') this.useHTTP(this.generation);
        else this.connect();
      }, 12000);
      this.onStatus();
      return true;
    }

    async sendHTTP(command, generation) {
      try {
        const { response, data } = await requestJSON(
          `${this.session.endpoint}/api/rooms/${this.session.code}/actions`, {
            method: 'POST', credentials: 'omit',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.session.token}` },
            body: JSON.stringify(command),
          });
        if (!this.active || generation !== this.generation) return;
        if (response.ok) this.acceptSnapshot(data);
        else {
          if (data.snapshot) this.acceptSnapshot(data.snapshot);
          this.busy = false;
          this.pendingId = null;
          clearTimeout(this.commandTimeout);
          this.message = data.error || 'Could not apply that move. Reconnect to refresh your board.';
          this.onStatus();
        }
      } catch {
        if (!this.active || generation !== this.generation) return;
        // The response may have been lost after saving the action. Read it back.
        this.connect();
      }
    }

    leave() {
      this.active = false;
      this.connected = false;
      this.waiting = false;
      this.pendingId = null;
      this.transport = 'socket';
      this.fatal = false;
      this.busy = false;
      ++this.generation;
      clearTimeout(this.retry);
      clearTimeout(this.commandTimeout);
      clearTimeout(this.socketTimeout);
      this.socket?.close();
      this.socket = null;
      this.lastState = null;
      this.lobby = null;
      this.message = '';
    }
  }
  window.FlottaOnline = FlottaOnline;
})();
