import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('late HTTPS reads cannot roll back the board or release an unacknowledged move', () => {
  const window = { addEventListener() {} };
  vm.runInNewContext(readFileSync(new URL('../online.js', import.meta.url), 'utf8'), {
    window, document: { addEventListener() {} }, localStorage: { getItem: () => null }, clearTimeout() {},
  });
  let updates = 0;
  const client = new window.FlottaOnline({ onState: () => updates++, onStatus() {} });
  client.httpSync = true;
  client.session = { seat: 0 };
  const snapshot = revision => ({ type: 'state', seat: 0, waiting: false, state: { revision }, lobby: {} });
  client.acceptSnapshot(snapshot(5));
  assert.equal(updates, 1);
  client.acceptSnapshot(snapshot(5));
  assert.equal(updates, 1, 'unchanged polls do not redraw the hand');
  client.busy = true;
  client.pendingId = 'my-move';
  client.acceptSnapshot(snapshot(6));
  assert.equal(client.busy, true, 'another player’s update is not an acknowledgement');
  client.acceptSnapshot({ ...snapshot(5), ackId: 'my-move' });
  assert.equal(client.lastState.revision, 6);
  assert.equal(client.busy, false, 'the late acknowledgement still releases its own move');
  client.acceptSnapshot({ type: 'state', seat: 0, waiting: true, state: null });
  assert.equal(client.lastState.revision, 6, 'an old lobby read cannot clear a started game');
});
