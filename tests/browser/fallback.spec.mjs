import { test, expect } from '@playwright/test';

const base = process.env.FLOTTA_BROWSER_URL || 'http://127.0.0.1:8788';

for (const allBlocked of [false, true]) test(`HTTPS recovery with ${allBlocked ? 'both' : 'one'} live sockets blocked`, async ({ browser }) => {
  const contexts = [], pages = [], httpSnapshots = [null, null], socketSnapshots = [null, null];
  const errors = [];
  try {
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({ viewport: { width: 1024, height: 960 }, hasTouch: true });
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      page.on('pageerror', error => errors.push(error.message));
      page.on('websocket', socket => socket.on('framereceived', frame => {
        const data = JSON.parse(String(frame.payload));
        if (data.type === 'state') socketSnapshots[i] = data;
      }));
      page.on('response', async response => {
        if (/\/api\/rooms\/.+\/(state|actions)$/.test(response.url()) && response.ok()) {
          const data = await response.json();
          if (data.type === 'state') httpSnapshots[i] = data;
        }
      });
      if (i === 0 || allBlocked) {
        await page.routeWebSocket('**/api/rooms/*/socket', ws => ws.close({ code: 1011, reason: 'Live socket unavailable on this network.' }));
      }
      await page.goto(base);
      await expect(page.locator('[data-human-count="2"]')).toBeVisible();
    }
    const [host, guest] = pages;
    await host.locator('[data-human-count="2"]').click();
    await host.locator('[data-online-create]').click();
    await expect(host.locator('.room-roster')).toBeVisible();
    const code = await host.locator('.big-room-code').innerText();
    await guest.locator('#room-code').fill(code);
    await guest.locator('[data-online-join]').click();
    await expect(guest.locator('.room-roster')).toBeVisible();
    await expect(host.locator('[data-online-start]')).toBeEnabled();
    await host.locator('[data-online-start]').click();
    for (const page of pages) await expect(page.locator('#player-hand .tile')).toHaveCount(15);
    expect(httpSnapshots[0].seat).toBe(0);
    expect(httpSnapshots[0].state.players[2].hand).toEqual([]);
    if (allBlocked) {
      expect(httpSnapshots[1].seat).toBe(2);
      expect(httpSnapshots[1].state.players[0].hand).toEqual([]);
    }
    const state = index => {
      const options = [httpSnapshots[index], socketSnapshots[index]].filter(s => s?.state);
      return options.sort((a, b) => b.state.revision - a.state.revision)[0]?.state;
    };
    const first = host.locator('#player-hand .tile').first();
    const id = await first.getAttribute('data-tile');
    await first.click();
    // An unchanged poll must not replace the hand and cancel the selection.
    await expect.poll(() => host.locator(`[data-tile="${id}"]`).getAttribute('aria-pressed'), { intervals: [2200] }).toBe('true');
    await host.waitForTimeout(2300);
    await expect(host.locator(`[data-tile="${id}"]`)).toHaveAttribute('aria-pressed', 'true');
    // Player 2 may arrange while waiting; their turn must become playable automatically.
    await guest.locator('[data-arrange]').tap();
    await expect(guest.locator('[data-arrange]')).toHaveAttribute('aria-expanded', 'true');
    let guestPlayed = false;
    for (let turn = 0; turn < 30 && !guestPlayed; turn++) {
      await expect.poll(() => state(0)?.players[state(0).current].human).toBe(true);
      const seat = state(0).current, active = pages[seat === 0 ? 0 : 1];
      await expect(active.locator('.turntitle')).toContainText('your turn');
      await expect(active.locator('[data-arrange]')).toHaveAttribute('aria-expanded', 'false');
      const revision = state(0).revision;
      if (await active.locator('#player-hand .suggest').count()) {
        // Arranging during your turn must also leave Play available.
        await active.locator('[data-arrange]').tap();
        await active.locator('#player-hand .suggest').first().tap();
        await expect(active.locator('#player-hand .sel')).toHaveCount(1);
        const handCount = await active.locator('#player-hand .tile').count();
        await active.locator('[data-target]:enabled').first().tap();
        await expect(active.locator('#player-hand .tile')).toHaveCount(handCount - 1);
        if (seat === 2) guestPlayed = true;
      } else if (await active.locator('[data-draw]').isEnabled()) await active.locator('[data-draw]').click();
      else await active.locator('[data-pass]').click();
      await expect.poll(() => state(0)?.revision).toBeGreaterThan(revision);
      await expect.poll(() => state(1)?.revision).toBeGreaterThan(revision);
    }
    expect(guestPlayed).toBe(true);
    const ids = await host.locator('#player-hand .tile').evaluateAll(es => es.map(e => e.dataset.tile));
    await host.reload();
    await host.locator('[data-online-resume]').click();
    await expect(host.locator('#player-hand')).toBeVisible();
    expect(await host.locator('#player-hand .tile').evaluateAll(es => es.map(e => e.dataset.tile))).toEqual(ids);
    expect(errors).toEqual([]);
  } finally {
    for (const context of contexts) await context.close();
  }
});
