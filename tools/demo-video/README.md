# Demo video recorder

Records clips of the real LetterLinx game being played, for videos and tutorials: vertical 1080×1920 MP4,
30 fps, with a finger marker showing each tap and drag. The clips have no sound; add audio in an editor.

It plays Brain Booster, so clips show no game number or date. A seed fixes the board, so the same seed
films the same game every time.

## Requirements

- Node.js, [Playwright](https://playwright.dev) with Chromium, and `ffmpeg` on the PATH.
- In this folder: `npm install` (installs the common-words list used to pick recognisable words).

## Use

1. Start the game locally from the repository root: `npm run dev` (no database needed).
2. Find a good board: `node record.js plan 1 12` lists the words each seed would play.
3. Film it: `node record.js film 5 --out=how-to-play.mp4`

Options for `film`:

- `--skip=word,word` avoids words you don't want in the clip.
- `--words=3` sets how many words are played (up to 5). Lengths build to a long final word.
- `--out=name.mp4` names the file. Clips are saved in `media/videos/`.

`BASE_URL=https://www.letterlinx.com node record.js film 5` films the live site instead, but leaves the
round in that browser only; nothing is saved to any account.

## Clips made so far

| File | Seed | Words |
|---|---|---|
| `media/videos/how-to-play.mp4` | 5 | VALET, STOOLS, EDUCATOR (60 points) |
