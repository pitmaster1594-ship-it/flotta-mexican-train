import { test, expect } from '@playwright/test';

const base = process.env.FLOTTA_BROWSER_URL || 'http://127.0.0.1:8788';

for (const count of [1, 2, 3, 4]) test(`${count} human players: lobby, private hands, play, and resume`, async ({ browser }, testInfo) => {
  const contexts = [], pages = [], snapshots = [], errors = [];
  const seats = count === 2 ? [0, 2] : Array.from({ length: count }, (_, i) => i);
  try {
    for (let i = 0; i < count; i++) {
      const context = await browser.newContext({
        viewport: { width: count === 3 ? 390 : 1024, height: 960 }, hasTouch: true,
      });
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => socket.on('framereceived', frame => {
        const message = JSON.parse(String(frame.payload));
        if (message.type === 'state') snapshots[i] = message;
      }));
      await page.goto(base);
      await expect(page.locator('[data-human-count="4"]')).toBeVisible();
    }
    const host = pages[0];
    await host.locator('[data-start="6"]').click();
    await host.locator(`[data-human-count="${count}"]`).click();
    await host.locator('[data-online-create]').click();
    await expect(host.locator('[data-online-start]')).toBeVisible();
    await expect.poll(() => snapshots[0]?.code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const code = snapshots[0].code;
    if (count > 1) await expect(host.locator('[data-online-start]')).toBeDisabled();
    for (let i = 1; i < count; i++) {
      await pages[i].locator('#room-code').fill(code);
      await pages[i].locator('[data-online-join]').click();
      await expect(pages[i].locator('.room-roster')).toBeVisible();
      await expect(pages[i].locator('[data-online-start]')).toHaveCount(0);
      await expect(host.locator('.lobby-count')).toContainText(`${i + 1} / ${count}`);
      await expect(host.locator('#player-hand')).toHaveCount(0);
      if (i < count - 1) await expect(host.locator('[data-online-start]')).toBeDisabled();
      await pages[i].reload();
      await pages[i].locator('[data-online-resume]').click();
      await expect(pages[i].locator('.room-roster')).toBeVisible();
      await expect.poll(() => snapshots[i]?.seat).toBe(seats[i]);
    }
    await expect(host.locator('[data-online-start]')).toBeEnabled();
    await host.locator('[data-online-start]').click();
    for (let i = 0; i < count; i++) {
      await expect(pages[i].locator('#player-hand .tile')).toHaveCount(15);
      const snapshot = snapshots[i];
      expect(snapshot.seat).toBe(seats[i]);
      expect(snapshot.state.humanCount).toBe(count);
      expect(snapshot.state.players.filter(p => p.human)).toHaveLength(count);
      expect(snapshot.state.players.filter(p => !p.human)).toHaveLength(4 - count);
      expect(snapshot.state.boneyard).toBeUndefined();
      expect(snapshot.token).toBeUndefined();
      expect(snapshot.lobby.tokens).toBeUndefined();
      for (let seat = 0; seat < 4; seat++) {
        expect(snapshot.state.players[seat].hand).toHaveLength(seat === seats[i] ? 15 : 0);
      }
      expect(await pages[i].evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }
    const humanIds = snapshots.flatMap((snapshot, i) => snapshot.state.players[seats[i]].hand.map(t => t.id));
    expect(new Set(humanIds).size).toBe(count * 15);

    // Each owner can arrange their hand while waiting for another player's turn.
    for (let i = count - 1; i >= 0; i--) {
      await pages[i].locator('[data-arrange]').click();
      const revision = snapshots[i].state.revision;
      await pages[i].locator('[data-sort]').click();
      await expect.poll(() => snapshots[i].state.revision).toBeGreaterThan(revision);
      if (i === 0 || i !== count - 1) await pages[i].locator('[data-arrange]').click();
    }

    async function takeHumanAction() {
      await expect.poll(() => snapshots[0].state.phase === 'roundend'
        || snapshots[0].state.players[snapshots[0].state.current].human).toBe(true);
      const state = snapshots[0].state;
      if (state.phase !== 'play') return false;
      const active = pages[seats.indexOf(state.current)];
      await expect(active.locator('.turntitle')).toContainText('your turn');
      await expect(active.locator('[data-arrange]')).toHaveAttribute('aria-expanded', 'false');
      await expect(active.locator('.save-status')).toHaveText('Room saved online');
      const revision = state.revision;
      if (await active.locator('#player-hand .suggest').count()) {
        await active.locator('#player-hand .suggest').first().tap();
        await expect(active.locator('#player-hand .sel')).toHaveCount(1);
        const handCount = await active.locator('#player-hand .tile').count();
        await active.locator('[data-target]:enabled').first().tap();
        await expect(active.locator('#player-hand .tile')).toHaveCount(handCount - 1);
      } else if (await active.locator('[data-draw]').isEnabled()) {
        await active.locator('[data-draw]').click();
      } else await active.locator('[data-pass]').click();
      await expect.poll(() => snapshots[0].state.revision).toBeGreaterThan(revision);
      return true;
    }
    for (let n = 0; n < 6; n++) if (!await takeHumanAction()) break;

    // All four-human rounds are driven to completion to check scoring and the next starter.
    if (count === 4) {
      for (let n = 0; n < 400 && snapshots[0].state.phase === 'play'; n++) await takeHumanAction();
      expect(snapshots[0].state.phase).toBe('roundend');
      for (let i = 1; i < count; i++) await expect(pages[i].locator('[data-next]')).toHaveCount(0);
      await expect(host.locator('[data-next]')).toContainText('Player 2 starts');
      await host.locator('[data-next]').click();
      await expect.poll(() => snapshots[0].state.round).toBe(1);
      expect(snapshots[0].state.current).toBe(1);
      await expect(pages[1].locator('.turntitle')).toContainText('your turn');
    }
    for (let i = 0; i < count; i++) {
      const ids = snapshots[i].state.players[seats[i]].hand.map(t => t.id);
      await pages[i].reload();
      await pages[i].locator('[data-online-resume]').click();
      await expect(pages[i].locator('#player-hand')).toBeVisible();
      expect(snapshots[i].seat).toBe(seats[i]);
      expect(snapshots[i].state.players[seats[i]].hand.map(t => t.id)).toEqual(ids);
    }
    expect(errors).toEqual([]);
    if (count === 4) await host.screenshot({ path: testInfo.outputPath('four-player-game.png'), fullPage: true });
  } finally {
    for (const context of contexts) await context.close();
  }
});
