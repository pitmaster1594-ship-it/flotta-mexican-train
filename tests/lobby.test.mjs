import test from 'node:test';
import assert from 'node:assert/strict';
import { GameRoom } from '../server/worker.mjs';
import { createGame } from '../server/game.mjs';

function setup(saved = null) {
  const storage = new Map(saved ? [['room', structuredClone(saved)]] : []);
  const sockets = [];
  const ctx = {
    storage: {
      get: async key => structuredClone(storage.get(key)),
      put: async (key, value) => storage.set(key, structuredClone(value)),
      setAlarm: async () => {}, deleteAll: async () => storage.clear(),
    },
    getWebSockets: () => sockets,
    blockConcurrencyWhile: callback => callback(),
  };
  const room = new GameRoom(ctx);
  function socket(seat) {
    const messages = [];
    const ws = { readyState: 1, deserializeAttachment: () => ({ seat }), send: text => messages.push(JSON.parse(text)) };
    sockets.push(ws);
    return { ws, messages };
  }
  return { room, storage, socket };
}

test('host starts only after every selected player is connected; double starts cannot redeal', async () => {
  for (const count of [1, 2, 3, 4]) {
    const fixture = setup();
    const created = await fixture.room.fetch(new Request('https://room/create', {
      method: 'POST', body: JSON.stringify({ code: 'ABCDEFGH', startEngine: 6, humanCount: count }),
    }));
    assert.equal(created.status, 201);
    const host = fixture.socket(0);
    if (count > 1) {
      await fixture.room.webSocketMessage(host.ws, JSON.stringify({ id: 'too-early', type: 'start', revision: 0 }));
      assert.match(host.messages.find(m => m.type === 'error').error, /every player/i);
      assert.equal(fixture.room.room.game, null);
    }
    const seats = [0];
    for (let i = 1; i < count; i++) {
      const joined = await fixture.room.fetch(new Request('https://room/join', { method: 'POST' }));
      assert.equal(joined.status, 201);
      const { seat } = await joined.json();
      assert.ok(!seats.includes(seat));
      seats.push(seat);
      const guest = fixture.socket(seat);
      await fixture.room.webSocketMessage(guest.ws, JSON.stringify({ id: 'guest-start', type: 'start', revision: 0 }));
      assert.match(guest.messages.find(m => m.type === 'error').error, /only Player 1/i);
    }
    assert.equal(fixture.room.room.game, null, 'joining alone never deals a new room');
    assert.equal(fixture.room.lobby().canStart, true);
    const full = await fixture.room.fetch(new Request('https://room/join', { method: 'POST' }));
    assert.equal(full.status, 409);
    await fixture.room.webSocketMessage(host.ws, JSON.stringify({ id: 'start-once', type: 'start', revision: 0 }));
    const game = structuredClone(fixture.room.room.game);
    assert.equal(game.humanCount, count);
    assert.equal(game.players.filter(p => p.human).length, count);
    await fixture.room.webSocketMessage(host.ws, JSON.stringify({ id: 'start-once', type: 'start', revision: 0 }));
    await fixture.room.webSocketMessage(host.ws, JSON.stringify({ id: 'start-again', type: 'start', revision: 0 }));
    assert.deepEqual(fixture.room.room.game, game);
    const restored = setup(fixture.storage.get('room'));
    await restored.room.ready;
    assert.deepEqual(restored.room.room.game, game, 'service restart preserves human count and all hands');
  }
});

test('joined players who disconnect must reconnect before the host can start', async () => {
  const fixture = setup();
  await fixture.room.fetch(new Request('https://room/create', {
    method: 'POST', body: JSON.stringify({ code: 'ABCDEFGH', startEngine: 12, humanCount: 2 }),
  }));
  const host = fixture.socket(0);
  await fixture.room.fetch(new Request('https://room/join', { method: 'POST' }));
  const guest = fixture.socket(2);
  guest.ws.readyState = 3;
  assert.equal(fixture.room.lobby().canStart, false);
  await fixture.room.webSocketMessage(host.ws, JSON.stringify({ id: 'offline-start', type: 'start', revision: 0 }));
  assert.equal(fixture.room.room.game, null);
  assert.equal(fixture.room.lobby().players[2].joined, true);
  assert.equal(fixture.room.lobby().players[2].connected, false);
  guest.ws.readyState = 1;
  assert.equal(fixture.room.lobby().canStart, true);
});

test('existing two-player rooms keep their seats, automatic joining, and saved games', async () => {
  const old = { code: 'ABCDEFGH', tokens: { 0: 'host-token', 2: null }, startEngine: 9,
    game: null, lastActive: Date.now(), actions: [] };
  const fixture = setup(old);
  const joined = await fixture.room.fetch(new Request('https://room/join', { method: 'POST' }));
  assert.equal((await joined.json()).seat, 2);
  assert.deepEqual(fixture.room.seats(), [0, 2]);
  assert.ok(fixture.room.room.game);
  const active = createGame(9);
  delete active.humanCount;
  const restored = setup({ ...old, tokens: { 0: 'host-token', 2: 'guest-token' }, game: active });
  await restored.room.ready;
  assert.deepEqual(restored.room.room.game, active);
  assert.equal(restored.room.snapshot(2).state.players[2].hand.length, 15);
  assert.equal(restored.room.snapshot(2).state.players[0].hand.length, 0);
});
