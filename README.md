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
- Swipe within a long train lane to browse its dominoes; the current end stays visible at the right.
- Your hand wraps into rows in the wooden tray below the board. Scroll the page for larger hands; there is no sideways hand scrolling. Select a domino, then tap **Play** beside a matching train.
- Use **Arrange** to sort, flip, or reorder tiles.
- Two-player mode hides each human hand behind a reveal screen.

The in-game house rules explain doubles, drawing, passing, and scoring. Games currently stay in memory only; refreshing the page starts over.
