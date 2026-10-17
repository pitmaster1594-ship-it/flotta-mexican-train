import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, applyAction, computerStep, moves, privateView, score } from '../server/game.mjs';

function seeded(seed) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}
const tiles = game => [...game.boneyard, ...game.mex, ...game.players.flatMap(p => [...p.hand, ...p.train])];
function command(game, seat, action) { return applyAction(game, seat, { revision: game.revision, ...action }); }

test('all starting doubles deal 90 unique tiles and exclude the engine', () => {
  for (const start of [12, 9, 6]) {
    const game = createGame(start, seeded(start));
    assert.equal(game.boneyard.length, 30);
    assert.ok(game.players.every(p => p.hand.length === 15));
    assert.equal(new Set(tiles(game).map(t => t.id)).size, 90);
    assert.ok(!tiles(game).some(t => t.a === start && t.b === start));
  }
  assert.throws(() => createGame(8));
});

test('each view contains only its owner’s hand and no boneyard or player credentials', () => {
  const game = createGame(12, seeded(4));
  for (const seat of [0, 2]) {
    const view = privateView(game, seat);
    assert.equal(view.players[seat].hand.length, 15);
    assert.equal(view.boneyardCount, 30);
    assert.equal(view.boneyard, undefined);
    assert.equal(view.seq, undefined);
    for (const other of [0, 1, 2, 3].filter(i => i !== seat)) {
      assert.deepEqual(view.players[other].hand, []);
      assert.equal(view.players[other].handCount, 15);
      for (const tile of game.players[other].hand) assert.ok(!JSON.stringify(view).includes(`"id":${tile.id},`));
    }
    view.players[seat].hand.pop();
    assert.equal(game.players[seat].hand.length, 15);
  }
});

test('wrong turns, forged tiles, stale revisions and illegal passes are rejected', () => {
  const game = createGame(12, seeded(10));
  const before = structuredClone(game);
  for (const [seat, action] of [
    [2, { type: 'draw' }],
    [0, { type: 'play', tileId: -1, target: 'm' }],
    [0, { type: 'pass' }],
    [0, { type: 'draw', revision: 0 }],
  ]) assert.throws(() => command(game, seat, action));
  assert.deepEqual(game, before);
});

test('arranging another player’s tiles is rejected; own order and flips persist', () => {
  const game = createGame(12, seeded(7));
  assert.throws(() => command(game, 2, { type: 'arrange', tiles: game.players[0].hand }));
  const order = [...game.players[2].hand].reverse().map(t => ({ id: t.id, flipped: true }));
  const current = game.current;
  command(game, 2, { type: 'arrange', tiles: order });
  assert.equal(game.current, current);
  assert.deepEqual(game.players[2].hand.map(t => t.id), order.map(t => t.id));
  assert.ok(game.players[2].hand.every(t => t.flipped));
});

test('one pass opens a train except while a double needs covering', () => {
  for (const pending of [null, 'm']) {
    const game = createGame(12, seeded(2));
    game.players[0].hand = [{ id: 999, a: 1, b: 2 }];
    game.pending = pending;
    assert.throws(() => command(game, 0, { type: 'pass' }));
    game.turnDraw = true;
    command(game, 0, { type: 'pass' });
    assert.equal(game.players[0].open, pending === null);
    assert.equal(game.current, 1);
    assert.equal(game.pending, pending);
  }
});

test('a covered double clears the restriction and own play closes the train', () => {
  const game = createGame(12, seeded(2));
  game.players[0].train = [{ id: 500, a: 5, b: 12, left: 12, right: 5 }, { id: 501, a: 5, b: 5, left: 5, right: 5 }];
  game.players[0].open = true;
  game.pending = 0;
  game.players[0].hand = [{ id: 502, a: 5, b: 6 }, { id: 503, a: 0, b: 1 }];
  assert.ok(moves(game, 0).every(m => m.target === 0));
  command(game, 0, { type: 'play', tileId: 502, target: 0 });
  assert.equal(game.pending, null);
  assert.equal(game.players[0].open, false);
});

test('complete games preserve tiles, score once, and rotate all round starters', () => {
  for (const start of [12, 9, 6]) for (let trial = 0; trial < 4; trial++) {
    const random = seeded(start * 100 + trial);
    const game = createGame(start, random);
    for (let round = 0; round <= start; round++) {
      assert.equal(game.current, round % 4);
      const previous = [...game.total];
      let steps = 0;
      while (game.phase === 'play') {
        assert.ok(++steps < 2000, 'round terminates');
        if (!game.players[game.current].human) computerStep(game);
        else {
          const options = moves(game, game.current);
          const action = options.length ? { type: 'play', tileId: options[0].tile.id, target: options[0].target }
            : !game.turnDraw && game.boneyard.length ? { type: 'draw' } : { type: 'pass' };
          command(game, game.current, action);
        }
        assert.equal(tiles(game).length, 90);
        assert.equal(new Set(tiles(game).map(t => t.id)).size, 90);
      }
      assert.deepEqual(game.total, previous.map((n, i) => n + score(game, i)));
      assert.throws(() => command(game, 2, { type: 'next' }));
      if (round < start) command(game, 0, { type: 'next' });
      else assert.throws(() => command(game, 0, { type: 'next' }));
    }
  }
});
