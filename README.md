# Flotta Mexican Train

A dependency-free double-12 dominoes game for one player against three computers, or two players sharing a device against two computers.

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

All three choices keep the double-12 deck and 15 tiles per player.

The game automatically saves after updates. **Save & exit** pauses play and returns to the menu; **Resume saved game** restores the scores, trains, tile order, boneyard, and current turn. A new game replaces the single saved game after confirmation. Two-player games show the private reveal screen when resumed.

Saves stay in the same browser on the same device. Clearing browser storage removes them. If saving is blocked or storage is full, the game shows a warning and Save & exit keeps the current game open.

The in-game house rules explain doubles, drawing, passing, and scoring.
