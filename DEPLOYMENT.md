# Deploy online multiplayer

Local games continue to work on GitHub Pages. Online games need the Cloudflare
room service; deploying this repository also gives you a complete game website
at the Worker's HTTPS address.

## Deploy from your iPad

1. Create a [Cloudflare account](https://dash.cloudflare.com/sign-up) if needed.
2. Open the deployment link below and sign into Cloudflare.
3. Connect your GitHub account when prompted and select this repository.
4. Deploy the Worker, then open its `workers.dev` website on both iPads.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pitmaster1594-ship-it/flotta-mexican-train)

If the deployment screen asks for commands, use:

| Setting | Value |
| --- | --- |
| Project root | Repository root |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Worker configuration | `wrangler.jsonc` |

Cloudflare creates the `GameRoom` SQLite Durable Object binding using the included
migration. No domain purchase or separate database setup is needed. The
configuration supports Workers Free and does not enable a paid subscription;
Cloudflare's current free-plan quotas still apply.

## Play with one to four humans

1. Open the game website on each person's iPad, phone, or browser.
2. The host chooses double 12, 9, or 6 and **1, 2, 3, or 4 human players**.
3. Tap **Create private room** (or **Create solo room** for one human).
4. Other humans enter the host's eight-character code and tap **Join room**.
5. The lobby lists all four seats, showing joined players and computers. Once
   all selected humans are connected, Player 1 taps **Start game**.
6. Computers fill unused seats: 1 human has 3 computers, 2 humans have 2 computers,
   3 humans have 1 computer, and 4 humans have no computers.

Each device sees only its own hand. Player 1 advances to the next round when a
round ends. Starting players rotate through all four seats. Previously saved
two-player rooms retain their seats and can still be resumed.

Keep the room code private: it invites the second player. A private seat
credential is saved automatically in each iPad's browser and is never included
in the room code. Use **Leave room** and **Resume online room** to return later.
Use the original browser on the original device; clearing its storage removes
its private seat credential. Rooms expire after 30 days without play.

The original GitHub Pages local save is kept separately and is not overwritten
by online play. A local save belongs to its original website address; use the
original GitHub Pages link to resume an existing local game.

## Optional: enable rooms on the GitHub Pages link too

Set `window.FLOTTA_ONLINE_URL` in `online-config.js` to the deployed Worker's
HTTPS origin, for example `https://flotta-mexican-train.YOUR-SUBDOMAIN.workers.dev`.
Commit and push that change. The Worker already allows the repository's GitHub
Pages origin in `ALLOWED_ORIGIN`. Update that variable if you use another domain.

Both iPads should use the same website address so that their room-resume
credentials stay in the browser storage where they were created.

## Deploy from a computer instead

```sh
npm ci
npx wrangler login
npm run deploy
```

Wrangler prints the live website address after deployment. Do not put Cloudflare
tokens in source files or share them in chat. Use Cloudflare's login or its
supported secure credential configuration.

## Development and checks

```sh
npm ci
npm test
npm run dev
```

Open the local URL in two separate browser profiles or a normal window and a
private window to represent separate iPads. Two tabs in the same browser share
one saved seat; opening that seat in a new tab disconnects its old tab.

With the development server running, use another terminal for:

```sh
npm run test:rooms
npx wrangler deploy --dry-run
```

`npm test` checks full games, private views, move validation, doubles, passing,
scoring, and agreement with the existing local rules. `test:rooms` checks the
real Durable Object service, synchronization, private hands, reconnection,
duplicate actions, stale revisions, and origin restrictions.

The service uses server-authoritative moves and WebSocket hibernation. Idle
rooms do not poll. Source assets are copied to `public/` by the build; backend
files, credentials, and development tools are not published as website assets.

## Browser regression tests

```sh
npx playwright install chromium
npm run test:browser
```

The browser tests start an isolated local service and use independent browser
contexts for every human. They check 1–4-player lobbies, host-only starting,
private hands, tile arrangement, reconnection, and a full four-human round with
scoring and the next starting player. To use a preinstalled Chromium, set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable path. To test a deployed
service, set `FLOTTA_BROWSER_URL` to its HTTPS game URL; tests then create fresh
private rooms on that service instead of starting a local one.
