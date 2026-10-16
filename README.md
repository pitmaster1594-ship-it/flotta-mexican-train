# Flotta Mexican Train

A dependency-free double-12 dominoes game for one player against three computers, or two players sharing a device against two computers.

## Run locally

Open `index.html` in a browser, or serve this directory:

```sh
python3 -m http.server 8000
```

Then visit http://localhost:8000. No build step or installation is needed.

## Layout and controls

- The shared Mexican Train sits above the opponent trains, with your train below them.
- Each train displays its open/closed status and current end number.
- On phones, tap a train heading to expand its full history.
- Your hand stays at the bottom of the screen. Select a domino, then choose a matching train.
- Use **Arrange** to sort, flip, or reorder tiles; otherwise swipe your hand to browse it.
- Two-player mode hides each human hand behind a reveal screen.

The in-game house rules explain doubles, drawing, passing, and scoring. Games currently stay in memory only; refreshing the page starts over.
