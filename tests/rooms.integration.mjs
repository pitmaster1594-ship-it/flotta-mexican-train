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
  assert.equal((await guest.wait(x => x.type === 'state')).state.revision, 2, 'duplicate does not apply twice');
  host.socket.send(JSON.stringify({ id: 'stale', type: 'draw', revision: 1 }));
  assert.match((await host.wait(x => x.type === 'error')).error, /changed/i);
  assert.equal((await host.wait(x => x.type === 'state')).state.revision, 2);

  guest.socket.close();
  const resumed = connect(sessions.guest);
  t.after(() => resumed.socket.close());
  const restored = await resumed.wait();
  assert.equal(restored.state.revision, 2);
  assert.deepEqual(restored.state.players[2].hand.map(t => t.id), order.map(t => t.id));
  assert.ok(restored.state.players[2].hand.every(t => t.flipped));
});

test('cross-origin requests and invalid room codes are rejected', async () => {
  const blocked = await fetch(base + '/api/rooms', { method: 'POST', headers: { Origin: 'https://unrelated.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ startEngine: 12 }) });
  assert.equal(blocked.status, 403);
  const invalid = await fetch(base + '/api/rooms/invalid/join', { method: 'POST' });
  assert.equal(invalid.status, 404);
  const wrongStart = await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ startEngine: 1 }) });
  assert.equal(wrongStart.status, 400);
});
