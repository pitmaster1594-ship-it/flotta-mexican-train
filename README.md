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
- Train lanes automatically follow new plays. Swipe to browse older dominoes, or tap **End** to return to the newest tile.
- Your hand wraps into rows in the wooden tray below the board. Scroll the page for larger hands; there is no sideways hand scrolling. Select a domino, then tap **Play** beside a matching train.
- Drag hand tiles directly to reorder them, including between rows. For an alternative, tap **Arrange tiles**, tap a tile, then tap another tile to insert it before that tile. Left/right, flip, and sort controls are also available. Tap **Done arranging** to resume playing.
- Two-player mode hides each human hand behind a reveal screen.

The in-game house rules explain doubles, drawing, passing, and scoring. Games currently stay in memory only; refreshing the page starts over.
