# LetterLinx

A one-minute word hunt for phones and desktops. Drag across neighbouring tiles to spell words.

## Files

- `index.html` – the game (markup, styles, script)
- `modes.js` – the game versions: grid size, timer, scoring. Shared by the page and the API
- `words.js` – English dictionary (about 270,000 words, 2–15 letters)
- `words-es.js` – Spanish dictionary (about 366,000 words, 2–10 letters, no accents, Ñ kept)
- `api/` – Vercel functions: accounts, score history, leaderboard (Postgres)
- `dev-server.js` – runs the site and the API locally

## Deploy on Vercel

1. Import this repository in Vercel and deploy. No build settings are needed.
2. In the project's **Storage** tab add **Neon** (Postgres), connect it to the project, then redeploy.
   This sets `DATABASE_URL`, which the API reads. The tables are created on the first request.

Without a database the game still plays; scores stay on each player's device and accounts are unavailable.

3. For email confirmation and password reset, add a `RESEND_API_KEY` environment variable (from resend.com) and
   verify the sending domain in Resend. Emails are sent from `LetterLinx <no-reply@letterlinx.com>`; set `EMAIL_FROM`
   to change that. Without the key, accounts work but emails are never confirmed and passwords can't be reset.

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
| `email_codes` | hashed 6-digit codes for confirming an email or resetting a password |

Emails and screen names are unique, ignoring case. Passwords are hashed with scrypt.
Deleting a player removes their games and sessions.

Codes last 15 minutes, stop working after 5 wrong guesses, and can be requested once a minute.
Players appear on the leaderboard only after confirming their email.

## API

- `POST /api/auth` – `{ action: "register" | "login" | "logout" | "verify" | "resend" | "forgot" | "reset", ... }`
- `GET | PATCH | DELETE /api/me` – read, update or delete the signed-in player
- `POST /api/games` – save a finished round `{ mode, words, at }`; the score is recomputed on the server
- `GET /api/leaderboard?mode=classic` – every confirmed player's best score in a game version

## Game versions and languages

Each entry in `modes` in `modes.js` is a game version with its own top 5, leaderboard and score
history (stored under its key in `games.mode`). Today there are two, one per word language:
`classic` (English) and `es` (Español). Players choose on the first tour slide and in Settings.

A version sets the grid, round length, minimum word length, points table, word list file,
alphabet and how often each letter is dealt. To add a language, add a word list file that sets a
global variable (see `words-es.js`) and a new entry in `modes.js`. Word lists are downloaded only
when their language is chosen. Rules beyond those settings need new code in `index.html`.

The interface text is English only.

## Word lists

Both lists come from MIT-licensed packages by Zeke Sikelianos, each described as derived from the
Letterpress word list: `an-array-of-english-words` and `an-array-of-spanish-words`. Their licence
text is in `THIRD-PARTY-NOTICES.md`.
