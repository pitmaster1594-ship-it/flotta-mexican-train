// Run `npm run dev` in another terminal, then `npm run test:rooms`.
import test from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.FLOTTA_TEST_URL || 'http://127.0.0.1:8787';

async function room() {
  const response = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startEngine: 6 }) });
  assert.equal(response.status, 201);
  const host = await response.json();
  const joined = await fetch(`${base}/api/rooms/${host.code}/join`, { method: 'POST' });
  assert.equal(joined.status, 201);
  return { host, guest: await joined.json() };
}

function connect(session) {
  const url = new URL(`/api/rooms/${session.code}/socket`, base);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, ['flotta-v1', 'auth.' + session.token]);
  const queue = [], pending = [];
  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);
    const match = pending.findIndex(wait => wait.predicate(data));
    if (match >= 0) {
      const [wait] = pending.splice(match, 1);
      clearTimeout(wait.timer);
      wait.resolve(data);
    } else queue.push(data);
  });
  const wait = (predicate = () => true) => new Promise((resolve, reject) => {
    const index = queue.findIndex(predicate);
    if (index >= 0) { resolve(queue.splice(index, 1)[0]); return; }
    const entry = { predicate, resolve, timer: setTimeout(() => {
      pending.splice(pending.indexOf(entry), 1);
      reject(new Error('Timed out waiting for room update.'));
    }, 6000) };
    pending.push(entry);
  });
  return { socket, wait };
}

test('room actions are authenticated, private, versioned, persisted, and idempotent', async t => {
  const sessions = await room();
  const host = connect(sessions.host), guest = connect(sessions.guest);
  t.after(() => { host.socket.close(); guest.socket.close(); });
  const [a, b] = await Promise.all([host.wait(), guest.wait()]);
  assert.equal(a.state.startEngine, 6);
  assert.equal(a.seat, 0);
  assert.equal(b.seat, 2);
  assert.equal(a.state.players[0].hand.length, 15);
  assert.deepEqual(a.state.players[2].hand, []);
  assert.equal(b.state.players[2].hand.length, 15);
  assert.deepEqual(b.state.players[0].hand, []);
  assert.equal(a.state.boneyard, undefined);
  assert.equal(a.token, undefined);
  const full = await fetch(`${base}/api/rooms/${sessions.host.code}/join`, { method: 'POST' });
  assert.equal(full.status, 409);

  guest.socket.send(JSON.stringify({ id: 'wrong-turn', type: 'draw', revision: 1 }));
  assert.match((await guest.wait(x => x.type === 'error')).error, /not your turn/i);
  assert.equal((await guest.wait(x => x.type === 'state')).state.revision, 1);

  const order = [...b.state.players[2].hand].reverse().map(t => ({ id: t.id, flipped: true }));
  const action = { id: 'arrange-once', type: 'arrange', revision: 1, tiles: order };
  guest.socket.send(JSON.stringify(action));
  const updated = await guest.wait(x => x.type === 'state' && x.state.revision === 2);
  const publicUpdate = await host.wait(x => x.type === 'state' && x.state.revision === 2);
  assert.deepEqual(updated.state.players[2].hand.map(t => t.id), order.map(t => t.id));
  assert.deepEqual(publicUpdate.state.players[2].hand, []);
  assert.equal(updated.state.current, 0, 'arranging does not consume a turn');

  guest.socket.send(JSON.stringify(action));
  assert.equal((await guest.wait(x => x.type === 'state' && x.state?.revision === 2)).state.revision, 2, 'duplicate does not apply twice');
  host.socket.send(JSON.stringify({ id: 'stale', type: 'draw', revision: 1 }));
  assert.match((await host.wait(x => x.type === 'error')).error, /changed/i);
  assert.equal((await host.wait(x => x.type === 'state' && x.state?.revision === 2)).state.revision, 2);

  guest.socket.close();
  const resumed = connect(sessions.guest);
  t.after(() => resumed.socket.close());
  const restored = await resumed.wait();
  assert.equal(restored.state.revision, 2);
  assert.deepEqual(restored.state.players[2].hand.map(t => t.id), order.map(t => t.id));
  assert.ok(restored.state.players[2].hand.every(t => t.flipped));
});

for (const count of [1, 2, 3, 4]) test(`${count}-human lobby assigns private seats, waits for connections, and starts once`, async t => {
  const response = await fetch(base + '/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startEngine: 9, humanCount: count }),
  });
  assert.equal(response.status, 201);
  const session = await response.json();
  const host = connect(session);
  const sockets = [host];
  t.after(() => sockets.forEach(client => client.socket.close()));
  const initial = await host.wait();
  assert.equal(initial.state, null);
  assert.equal(initial.lobby.humanCount, count);
  assert.equal(initial.lobby.canStart, count === 1);
  assert.equal(initial.lobby.players.filter(p => p.human).length, count);

  if (count > 1) {
    host.socket.send(JSON.stringify({ id: 'early-start', type: 'start', revision: 0 }));
    assert.match((await host.wait(x => x.type === 'error')).error, /every player/i);
  }
  const responses = await Promise.all(Array.from({ length: count - 1 }, () =>
    fetch(`${base}/api/rooms/${session.code}/join`, { method: 'POST' })));
  const guests = [];
  for (const response of responses) {
    assert.equal(response.status, 201);
    guests.push(await response.json());
  }
  assert.equal(new Set([session, ...guests].map(s => s.seat)).size, count);
  if (count > 1) {
    const filled = await host.wait(x => x.type === 'state' && x.lobby.players.filter(p => p.joined).length === count);
    assert.equal(filled.state, null, 'joining never deals before the host starts');
    assert.equal(filled.lobby.canStart, false, 'joining without a socket is not connected');
  }
  for (const guestSession of guests) {
    const guest = connect(guestSession);
    sockets.push(guest);
    const view = await guest.wait();
    assert.equal(view.state, null);
    assert.equal(view.seat, guestSession.seat);
    guest.socket.send(JSON.stringify({ id: 'guest-start', type: 'start', revision: 0 }));
    assert.match((await guest.wait(x => x.type === 'error')).error, /only Player 1/i);
  }
  if (count > 1) await host.wait(x => x.type === 'state' && x.lobby.canStart);
  const full = await fetch(`${base}/api/rooms/${session.code}/join`, { method: 'POST' });
  assert.equal(full.status, 409);
  const start = { id: 'start-once', type: 'start', revision: 0 };
  host.socket.send(JSON.stringify(start));
  const started = await host.wait(x => x.type === 'state' && x.state?.revision === 1);
  assert.equal(started.state.humanCount, count);
  assert.equal(started.state.players.filter(p => !p.human).length, 4 - count);
  for (let i = 0; i < guests.length; i++) {
    const view = await sockets[i + 1].wait(x => x.type === 'state' && x.state?.revision === 1);
    for (let seat = 0; seat < 4; seat++) assert.equal(view.state.players[seat].hand.length, seat === guests[i].seat ? 15 : 0);
  }
  host.socket.send(JSON.stringify(start));
  const duplicate = await host.wait(x => x.type === 'state' && x.state?.revision === 1);
  assert.deepEqual(duplicate.state, started.state, 'duplicate start cannot redeal');

  if (guests.length) {
    const last = guests.at(-1), client = sockets.at(-1);
    const own = started.state.players[last.seat];
    assert.equal(own.hand.length, 0, 'host never receives this seat’s hand');
    client.socket.close();
    const resumed = connect(last);
    sockets.push(resumed);
    const restored = await resumed.wait();
    assert.equal(restored.seat, last.seat);
    assert.equal(restored.state.humanCount, count);
    assert.equal(restored.state.players[last.seat].hand.length, 15);
  }
});

test('cross-origin requests and invalid room codes are rejected', async () => {
  const blocked = await fetch(base + '/api/rooms', { method: 'POST', headers: { Origin: 'https://unrelated.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ startEngine: 12 }) });
  assert.equal(blocked.status, 403);
  const invalid = await fetch(base + '/api/rooms/invalid/join', { method: 'POST' });
  assert.equal(invalid.status, 404);
  const wrongStart = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startEngine: 1 }) });
  assert.equal(wrongStart.status, 400);
  for (const humanCount of [0, 5, 1.5, '4', null]) {
    const invalidCount = await fetch(base + '/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startEngine: 12, humanCount }),
    });
    assert.equal(invalidCount.status, 400);
  }
});

test('HTTPS synchronization authenticates each seat and shares the same saved game', async () => {
  const created = await fetch(base + '/api/rooms', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ startEngine: 6, humanCount: 4 }),
  });
  const host = await created.json(), sessions = [host];
  for (let i = 1; i < 4; i++) {
    const response = await fetch(`${base}/api/rooms/${host.code}/join`, { method: 'POST' });
    sessions.push(await response.json());
  }
  async function state(session) {
    const response = await fetch(`${base}/api/rooms/${host.code}/state`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    assert.equal(response.status, 200);
    return response.json();
  }
  async function action(session, command) {
    return fetch(`${base}/api/rooms/${host.code}/actions`, {
      method: 'POST', headers: { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
  }
  const invalid = await fetch(`${base}/api/rooms/${host.code}/state`, { headers: { Authorization: 'Bearer invalid' } });
  assert.equal(invalid.status, 403);
  assert.equal((await invalid.json()).snapshot, undefined);
  for (const session of sessions) await state(session);
  assert.equal((await state(host)).lobby.canStart, true);
  const denied = await action(sessions[3], { id: 'guest-cannot-start', type: 'start', revision: 0 });
  assert.equal(denied.status, 400);
  const started = await action(host, { id: 'http-start', type: 'start', revision: 0 });
  assert.equal(started.status, 200);
  const startState = await started.json();
  assert.equal(startState.ackId, 'http-start');
  assert.equal(startState.state.revision, 1);
  for (const session of sessions) {
    const view = await state(session);
    assert.equal(view.seat, session.seat);
    for (let seat = 0; seat < 4; seat++) assert.equal(view.state.players[seat].hand.length, seat === session.seat ? 15 : 0);
  }
  const last = sessions[3], view = await state(last);
  const order = [...view.state.players[last.seat].hand].reverse().map(t => ({ id: t.id, flipped: true }));
  const arrange = { id: 'http-arrange', type: 'arrange', revision: 1, tiles: order };
  const saved = await action(last, arrange);
  const snapshot = await saved.json();
  assert.equal(snapshot.ackId, 'http-arrange');
  assert.equal(snapshot.state.revision, 2);
  assert.equal((await (await action(last, arrange)).json()).state.revision, 2, 'HTTPS retry cannot duplicate an action');
  const socket = connect(last);
  try {
    const restored = await socket.wait();
    assert.equal(restored.state.revision, 2);
    assert.deepEqual(restored.state.players[last.seat].hand.map(t => t.id), order.map(t => t.id));
  } finally { socket.socket.close(); }
  const spoof = await action(last, { id: 'spoof-seat', type: 'draw', revision: 2, seat: 0 });
  assert.equal(spoof.status, 400);
  assert.match((await spoof.json()).error, /not your turn/i);
  const preflight = await fetch(`${base}/api/rooms/${host.code}/state`, {
    method: 'OPTIONS', headers: {
      Origin: 'https://pitmaster1594-ship-it.github.io',
      'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization',
    },
  });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /authorization/i);
});
