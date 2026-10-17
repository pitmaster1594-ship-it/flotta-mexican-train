// The server owns every hand, draw, move, score and turn in an online room.
export class GameError extends Error {}
const requireRule = (ok, message) => { if (!ok) throw new GameError(message); };

export function createGame(startEngine = 12, random = Math.random) {
  requireRule([12, 9, 6].includes(startEngine), 'Choose a starting double of 12, 9, or 6.');
  const game = {
    mode: 2, startEngine, engine: startEngine, round: 0, revision: 1, seq: 0,
    players: [
      { name: 'Player 1', human: true }, { name: 'Computer 1', human: false },
      { name: 'Player 2', human: true }, { name: 'Computer 2', human: false },
    ],
    total: [0, 0, 0, 0],
  };
  dealRound(game, random);
  return game;
}

function dealRound(game, random) {
  const deck = [];
  for (let a = 0; a <= 12; a++) for (let b = a; b <= 12; b++) {
    if (a !== game.engine || b !== game.engine) deck.push({ id: ++game.seq, a, b });
  }
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  game.players.forEach(player => Object.assign(player, { hand: [], train: [], open: false }));
  for (let i = 0; i < 15; i++) for (const player of game.players) player.hand.push(deck.pop());
  Object.assign(game, {
    boneyard: deck, mex: [], current: game.round % 4, turnDraw: false,
    pending: null, selected: null, selectedTrain: null, awaiting: false, passes: 0,
    phase: 'play', notice: `Round ${game.round + 1}: double-${game.engine}. ${game.players[game.round % 4].name} starts.`,
  });
}

export function head(game, target) {
  const train = target === 'm' ? game.mex : game.players[target].train;
  return train.at(-1)?.right ?? game.engine;
}

function eligible(game, target, seat) {
  if (game.pending !== null) return game.pending === target;
  return target === 'm' || target === seat || game.players[target].open;
}

export function moves(game, seat) {
  const result = [];
  for (const tile of game.players[seat].hand) for (const target of ['m', 0, 1, 2, 3]) {
    if (!eligible(game, target, seat)) continue;
    const end = head(game, target);
    if (tile.a === end) result.push({ tile, target, left: tile.a, right: tile.b });
    else if (tile.b === end) result.push({ tile, target, left: tile.b, right: tile.a });
  }
  return result;
}

export const score = (game, seat) => game.players[seat].hand.reduce((sum, t) => sum + t.a + t.b, 0);
function finishRound(game, winner) {
  game.phase = 'roundend';
  game.players.forEach((_, i) => { game.total[i] += score(game, i); });
  game.notice = winner === null ? 'No more plays available.' : `${game.players[winner].name} finished their dominoes!`;
}

function nextPlayer(game) {
  game.current = (game.current + 1) % 4;
  game.turnDraw = false;
}

function play(game, seat, action) {
  const move = moves(game, seat).find(m => m.tile.id === action.tileId && m.target === action.target);
  requireRule(move, 'That domino cannot be played on that train.');
  const player = game.players[seat];
  player.hand.splice(player.hand.findIndex(t => t.id === move.tile.id), 1);
  const train = move.target === 'm' ? game.mex : game.players[move.target].train;
  train.push({ ...move.tile, left: move.left, right: move.right });
  if (move.target === seat) player.open = false;
  game.pending = move.left === move.right ? move.target : null;
  game.turnDraw = false;
  game.passes = 0;
  game.notice = `${player.name} played ${move.left}–${move.right} on ${move.target === 'm' ? 'Mexican Train' : game.players[move.target].name + "'s train"}.${game.pending !== null ? ' Double! The next play must satisfy it.' : ''}`;
  if (!player.hand.length) finishRound(game, seat);
  else nextPlayer(game);
}

function arrange(game, seat, action) {
  const hand = game.players[seat].hand;
  requireRule(Array.isArray(action.tiles) && action.tiles.length === hand.length, 'The hand has changed. Try arranging it again.');
  const ids = new Set(action.tiles.map(t => t?.id));
  requireRule(ids.size === hand.length && hand.every(t => ids.has(t.id)), 'Only your own dominoes can be arranged.');
  const tiles = new Map(hand.map(t => [t.id, t]));
  game.players[seat].hand = action.tiles.map(t => ({ ...tiles.get(t.id), flipped: t.flipped === true }));
}

export function applyAction(game, seat, action, random = Math.random) {
  requireRule(action && typeof action === 'object', 'Invalid action.');
  requireRule(Number.isInteger(seat) && seat >= 0 && seat < 4, 'Invalid player.');
  requireRule(action.revision === game.revision, 'The game changed. Your board has been refreshed; try again.');
  if (action.type === 'next') {
    requireRule(seat === 0, 'Player 1 starts the next round.');
    requireRule(game.phase === 'roundend' && game.engine > 0, 'The next round is not ready.');
    game.round++;
    game.engine--;
    dealRound(game, random);
  } else {
    requireRule(game.phase === 'play', 'This round has finished.');
    if (action.type === 'arrange') {
      requireRule(game.players[seat].human, 'Invalid player.');
      arrange(game, seat, action);
    } else {
      requireRule(game.current === seat, 'It is not your turn.');
      if (action.type === 'play') play(game, seat, action);
      else if (action.type === 'draw') {
        requireRule(!moves(game, seat).length && !game.turnDraw && game.boneyard.length, 'You cannot draw now.');
        game.players[seat].hand.push(game.boneyard.pop());
        game.turnDraw = true;
        game.notice = `${game.players[seat].name} drew a domino.`;
      } else if (action.type === 'pass') {
        requireRule(!moves(game, seat).length && (game.turnDraw || !game.boneyard.length), 'Draw first, or play a matching domino.');
        if (game.pending === null) game.players[seat].open = true;
        game.notice = `${game.players[seat].name} could not play. ${game.pending === null ? 'Their train is now open.' : 'The double still needs matching.'}`;
        game.passes++;
        if (game.passes >= 4 && !game.boneyard.length) finishRound(game, null);
        else nextPlayer(game);
      } else throw new GameError('Unknown game action.');
    }
  }
  game.revision++;
  return game;
}

export function computerStep(game) {
  if (game.phase !== 'play' || game.players[game.current].human) return false;
  const seat = game.current;
  const options = moves(game, seat).sort((a, b) =>
    (b.tile.a + b.tile.b) - (a.tile.a + a.tile.b) + (a.target === seat ? 1 : 0) - (b.target === seat ? 1 : 0));
  const action = options.length ? { type: 'play', tileId: options[0].tile.id, target: options[0].target }
    : !game.turnDraw && game.boneyard.length ? { type: 'draw' } : { type: 'pass' };
  applyAction(game, seat, { ...action, revision: game.revision });
  return true;
}

export function privateView(game, seat) {
  // Other hands and the boneyard never leave the server, including tile IDs.
  return {
    mode: game.mode, startEngine: game.startEngine, engine: game.engine, round: game.round,
    revision: game.revision, total: [...game.total], current: game.current,
    turnDraw: game.turnDraw, pending: game.pending, passes: game.passes,
    phase: game.phase, notice: game.notice, mex: structuredClone(game.mex),
    boneyardCount: game.boneyard.length, selected: null, selectedTrain: null, awaiting: false,
    players: game.players.map((p, i) => ({
      name: p.name, human: p.human, open: p.open, train: structuredClone(p.train),
      handCount: p.hand.length, hand: i === seat ? structuredClone(p.hand) : [],
      roundScore: game.phase === 'roundend' ? score(game, i) : null,
    })),
  };
}
