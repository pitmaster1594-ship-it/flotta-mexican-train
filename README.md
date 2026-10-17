# Flotta Mexican Train

A double-12 dominoes game for one player against three computers, two players sharing a device, or two players on separate iPads using private online rooms.

Local play needs no installation. Online multiplayer uses a Cloudflare Worker
and SQLite Durable Objects. See [deployment and multiplayer setup](DEPLOYMENT.md).

## Run locally

Open `index.html` in a browser, or serve this directory:

```sh
python3 -m http.server 8000
```

Then visit http://localhost:8000. No build step or installation is needed.

## Layout and controls

- Five horizontal lanes show the shared Mexican Train, the opponents, and your own train.
- Each train displays its open/closed status and current end number.
- Every train lane automatically returns to its newest domino after each board update and screen resize. Swipe to browse older dominoes between updates, or tap **End** to return immediately.
- Your hand wraps into rows in the wooden tray below the board. Scroll the page for larger hands; there is no sideways hand scrolling. Select a domino, then tap **Play** beside a matching train.
- Drag hand tiles directly to reorder them, including between rows. For an alternative, tap **Arrange tiles**, tap a tile, then tap another tile to insert it before that tile. Left/right, flip, and sort controls are also available. Tap **Done arranging** to resume playing.
- Two-player mode hides each human hand behind a reveal screen.

## Game length and saving

Choose the starting double before starting a new game:

- **12:** 13 rounds (12 down to blank).
- **9:** 10 rounds (9 down to blank).
- **6:** 7 rounds (6 down to blank).

All three choices keep the double-12 deck and 15 tiles per player. The starting player rotates each round in normal turn order, beginning with You (or Player 1).

The game automatically saves after updates. **Save & exit** pauses play and returns to the menu; **Resume saved game** restores the scores, trains, tile order, boneyard, and current turn. A new game replaces the single saved game after confirmation. Two-player games show the private reveal screen when resumed.

Saves stay in the same browser on the same device. Clearing browser storage removes them. If saving is blocked or storage is full, the game shows a warning and Save & exit keeps the current game open.

The in-game house rules explain doubles, drawing, passing, and scoring.

## Online rooms

On the Cloudflare-hosted game, choose **Create private room**, then enter its
eight-character code on the second iPad using **Join room**. Both iPads see the
same trains and scores, but each receives only its own hand. Online rooms save
on the server, support reconnection, and expire after 30 days without play.
**Resume online room** restores your seat on the same browser and device.

Your local saved game remains separate. The online menu appears only when the
configured room service is available. The GitHub Pages link continues to support
local play even before the Cloudflare service is deployed.
