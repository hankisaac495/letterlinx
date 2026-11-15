# LetterLinx

A one-minute word hunt for phones and desktops. Drag across neighbouring tiles to spell words.

## Files

- `index.html` – the game (markup, styles, script)
- `modes.js` – the game versions: grid size, timer, scoring. Shared by the page and the API
- `words.js` – the dictionary of valid words (about 270,000 entries)
- `api/` – Vercel functions: accounts, score history, leaderboard (Postgres)
- `dev-server.js` – runs the site and the API locally

## Deploy on Vercel

1. Import this repository in Vercel and deploy. No build settings are needed.
2. In the project's **Storage** tab add **Neon** (Postgres), connect it to the project, then redeploy.
   This sets `DATABASE_URL`, which the API reads. The tables are created on the first request.

Without a database the game still plays; scores stay on each player's device and accounts are unavailable.

## Run locally

```bash
npm install
```

```bash
DATABASE_URL=postgres://user:password@localhost:5432/letterlinx npm run dev
```

Open http://localhost:3000.

## Database

| Table | Holds |
|---|---|
| `players` | first name, last name, email, screen name, password hash, created date |
| `games` | player, game version (`mode`), score, words found, date played |
| `sessions` | hashed sign-in tokens with an expiry |

Emails and screen names are unique, ignoring case. Passwords are hashed with scrypt.
Deleting a player removes their games and sessions.

## API

- `POST /api/auth` – `{ action: "register" | "login" | "logout", ... }`
- `GET | PATCH | DELETE /api/me` – read, update or delete the signed-in player
- `POST /api/games` – save a finished round `{ mode, words, at }`; the score is recomputed on the server
- `GET /api/leaderboard?mode=classic` – every registered player's best score in a game version

## Adding a game version

Add an entry to `modes` in `modes.js`:

```js
sprint: { name: "Sprint", cols: 5, rows: 6, seconds: 30, tickFrom: 5, minLength: 3, points: [0, 0, 0, 2, 4, 8, 16] }
```

A version picker appears on the game screen once there is more than one. Each version has its own
top 5 and leaderboard, and its rounds are stored under its key in `games.mode`. Rules beyond grid
size, timer, minimum length and scoring need new code in `index.html`.
