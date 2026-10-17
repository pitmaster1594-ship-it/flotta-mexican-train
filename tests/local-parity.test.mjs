import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createGame, applyAction, moves } from '../server/game.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace('render();})();',
  'globalThis.localGame={newGame,doPlay,drawOne,cantPlay,get state(){return state},nextRound(){state.round++;state.engine--;dealRound()}};render();})();');
function random(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function comparable(game) {
  return JSON.parse(JSON.stringify({
    startEngine: game.startEngine, engine: game.engine, round: game.round,
    players: game.players, mex: game.mex, boneyard: game.boneyard, current: game.current,
    total: game.total, phase: game.phase, pending: game.pending,
    turnDraw: game.phase === 'play' ? game.turnDraw : null,
    passes: game.phase === 'play' ? game.passes : null,
  }));
}

test('online rules match existing local play for full games at every starting double', () => {
  for (const start of [12, 9, 6]) {
    const math = Object.create(Math);
    math.random = random(start);
    const app = { innerHTML: '', addEventListener() {}, querySelectorAll: () => [], insertAdjacentHTML() {} };
    const context = vm.createContext({
      Math: math, URLSearchParams, location: { search: '' },
      document: { getElementById: () => app, addEventListener() {}, body: { classList: { add() {}, remove() {} } } },
      window: { addEventListener() {} }, localStorage: { getItem: () => null, setItem() {} },
      setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {},
    });
    vm.runInContext(script, context);
    const local = context.localGame;
    local.newGame(2, start);
    const serverRandom = random(start);
    const game = createGame(start, serverRandom);
    for (let round = 0; round <= start; round++) {
      let count = 0;
      while (game.phase === 'play') {
        assert.ok(++count < 2000);
        assert.deepEqual(comparable(game), comparable(local.state));
        const seat = game.current, options = moves(game, seat);
        let action;
        if (options.length) {
          const move = options[0];
          action = { type: 'play', tileId: move.tile.id, target: move.target };
          local.doPlay({ ti: local.state.players[seat].hand.find(t => t.id === move.tile.id), t: move.target, left: move.left, right: move.right });
        } else if (!game.turnDraw && game.boneyard.length) {
          action = { type: 'draw' };
          local.drawOne();
        } else {
          action = { type: 'pass' };
          local.cantPlay();
        }
        applyAction(game, seat, { ...action, revision: game.revision }, serverRandom);
      }
      assert.deepEqual(comparable(game), comparable(local.state));
      if (round < start) {
        local.nextRound();
        applyAction(game, 0, { type: 'next', revision: game.revision }, serverRandom);
      }
    }
  }
});
