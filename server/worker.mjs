import { createGame, applyAction, computerStep, privateView, GameError } from './game.mjs';

const ROOM_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
const EXPIRY = 30 * 24 * 60 * 60 * 1000;
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const token = () => crypto.randomUUID() + crypto.randomUUID();
const random = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;

async function body(request) {
  const text = await request.text();
  if (text.length > 4096) throw new GameError('Request is too large.');
  try { return JSON.parse(text); } catch { throw new GameError('Invalid request.'); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const origin = request.headers.get('Origin');
    const allowed = !origin || origin === url.origin || origin === env.ALLOWED_ORIGIN;
    if (!allowed) return json({ error: 'This website is not allowed to connect.' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    let response;
    try {
      if (url.pathname === '/api/info' && request.method === 'GET') response = json({ multiplayer: true, version: 1 });
      else if (url.pathname === '/api/rooms' && request.method === 'POST') {
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        const code = Array.from(crypto.getRandomValues(new Uint8Array(8)), n => alphabet[n % alphabet.length]).join('');
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        response = await stub.fetch(new Request(`${url.origin}/create`, { method: 'POST', body: JSON.stringify({ ...await body(request), code }) }));
      } else {
        const match = url.pathname.match(/^\/api\/rooms\/([A-HJ-NP-Z2-9]{8})\/(join|socket)$/);
        if (!match) return json({ error: 'Room not found.' }, 404);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
        const internal = new URL(request.url);
        internal.pathname = '/' + match[2];
        response = await stub.fetch(new Request(internal, request));
      }
    } catch (error) {
      response = json({ error: error instanceof GameError ? error.message : 'The room service is temporarily unavailable.' }, error instanceof GameError ? 400 : 500);
    }
    if (response.status === 101) return response;
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors(origin))) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  },
};

function cors(origin) {
  return {
    ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export class GameRoom {
  constructor(ctx) {
    this.ctx = ctx;
    this.room = null;
    this.queue = Promise.resolve();
    this.ready = ctx.blockConcurrencyWhile(async () => { this.room = await ctx.storage.get('room') ?? null; });
  }

  async serial(callback) {
    const previous = this.queue;
    let release;
    this.queue = new Promise(resolve => { release = resolve; });
    await previous;
    await this.ready;
    try { return await callback(); } finally { release(); }
  }

  async fetch(request) {
    return this.serial(async () => {
      try {
        const path = new URL(request.url).pathname;
        // Drain forwarded POST streams before replying; otherwise workerd can
        // attempt to pump the body after the outer response has already ended.
        if (path === '/join' && request.method === 'POST') {
          if ((await request.text()).length > 4096) return json({ error: 'Request is too large.' }, 400);
        }
        if (path === '/create' && request.method === 'POST') {
          if (this.room) return json({ error: 'Try creating a room again.' }, 409);
          const options = await body(request);
          if (![12, 9, 6].includes(options.startEngine) || !ROOM_PATTERN.test(options.code)) return json({ error: 'Invalid room options.' }, 400);
          this.room = { code: options.code, tokens: { 0: token(), 2: null }, startEngine: options.startEngine, game: null, lastActive: Date.now(), actions: [] };
          await this.persist();
          return json({ code: this.room.code, token: this.room.tokens[0], seat: 0 }, 201);
        }
        if (!this.room || Date.now() - this.room.lastActive > EXPIRY) return json({ error: 'This room has expired or does not exist. Create a new room.' }, 404);
        if (path === '/join' && request.method === 'POST') {
          if (this.room.tokens[2]) return json({ error: 'This room already has two players. Use Resume online room on your original device.' }, 409);
          this.room.tokens[2] = token();
          this.room.game = createGame(this.room.startEngine, random);
          this.room.lastActive = Date.now();
          await this.persist();
          this.broadcast();
          return json({ code: this.room.code, token: this.room.tokens[2], seat: 2 }, 201);
        }
        if (path === '/socket' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
          const protocols = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map(x => x.trim());
          const auth = protocols.find(p => p.startsWith('auth.'))?.slice(5);
          const seat = [0, 2].find(seat => auth && this.room.tokens[seat] === auth);
          if (seat === undefined || !protocols.includes('flotta-v1')) return json({ error: 'This device cannot access that seat.' }, 403);
          const sockets = this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment()?.seat === seat);
          // A reload replaces this seat's old connection without consuming extra sockets.
          for (const ws of sockets) { try { ws.close(4001, 'This seat opened in another tab.'); } catch {} }
          const pair = new WebSocketPair();
          const [client, server] = Object.values(pair);
          this.ctx.acceptWebSocket(server);
          server.serializeAttachment({ seat });
          this.room.lastActive = Date.now();
          await this.persist();
          server.send(JSON.stringify(this.snapshot(seat)));
          return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'flotta-v1' } });
        }
        return json({ error: 'Room not found.' }, 404);
      } catch (error) {
        return json({ error: error instanceof GameError ? error.message : 'Could not open the room.' }, error instanceof GameError ? 400 : 500);
      }
    });
  }

  snapshot(seat) {
    return { type: 'state', code: this.room.code, seat, waiting: !this.room.game,
      state: this.room.game ? privateView(this.room.game, seat) : null };
  }

  broadcast() {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify(this.snapshot(ws.deserializeAttachment().seat))); } catch {}
    }
  }

  async persist() {
    await this.ctx.storage.put('room', this.room);
    const cpu = this.room.game?.phase === 'play' && !this.room.game.players[this.room.game.current].human;
    await this.ctx.storage.setAlarm(cpu ? Date.now() + 650 : this.room.lastActive + EXPIRY);
  }

  async webSocketMessage(ws, message) {
    await this.serial(async () => {
      try {
        if (typeof message !== 'string' || message.length > 4096) throw new GameError('Invalid game action.');
        const action = JSON.parse(message);
        const seat = ws.deserializeAttachment()?.seat;
        if (![0, 2].includes(seat) || !this.room?.game) throw new GameError('Wait for both players to join.');
        if (typeof action.id !== 'string' || action.id.length > 80) throw new GameError('Invalid game action.');
        if (this.room.actions.includes(`${seat}:${action.id}`)) { ws.send(JSON.stringify(this.snapshot(seat))); return; }
        // Work on a copy so rejected actions cannot partially change the stored game.
        const next = structuredClone(this.room.game);
        applyAction(next, seat, action, random);
        this.room.game = next;
        this.room.actions.push(`${seat}:${action.id}`);
        this.room.actions = this.room.actions.slice(-64);
        this.room.lastActive = Date.now();
        await this.persist();
        this.broadcast();
      } catch (error) {
        try {
          ws.send(JSON.stringify({ type: 'error', error: error instanceof GameError ? error.message : 'Could not apply that move. Please reconnect.' }));
          if (this.room) ws.send(JSON.stringify(this.snapshot(ws.deserializeAttachment()?.seat)));
        } catch {}
      }
    });
  }

  async alarm() {
    await this.serial(async () => {
      if (!this.room) return;
      if (Date.now() - this.room.lastActive >= EXPIRY) {
        for (const ws of this.ctx.getWebSockets()) { try { ws.close(1000, 'Room expired.'); } catch {} }
        await this.ctx.storage.deleteAll();
        this.room = null;
        return;
      }
      if (this.room.game && computerStep(this.room.game)) {
        this.room.lastActive = Date.now();
        await this.persist();
        this.broadcast();
      } else await this.persist();
    });
  }

  webSocketClose() {}
  webSocketError(ws) { try { ws.close(1011, 'Reconnect to continue.'); } catch {} }
}
