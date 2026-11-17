# LetterLinx

A one-minute word hunt for phones and desktops. Drag across neighbouring tiles to spell words.

## Files

- `index.html` – the game (markup, styles, script)
- `modes.js` – the game versions: grid size, timer, scoring. Shared by the page and the API
- `build-pages.js` – generates the search tags and `es/index.html`
- `i18n.js` – interface text in English and Spanish
- `about/`, `contact/`, `privacy/` – the About, Contact and Privacy Policy pages, styled by `pages.css`
- `words.js` – English dictionary (about 270,000 words, 2–15 letters)
- `words-es.js` – Spanish dictionary (about 366,000 words, 2–10 letters, no accents, Ñ kept)
- `api/` – Vercel functions: accounts, score history, leaderboard (Postgres)
- `dev-server.js` – runs the site and the API locally

## Installing as an app

`manifest.webmanifest` and `sw.js` let players add the game to their home screen, where it opens full screen
without browser bars. The service worker caches nothing, so every visit loads the latest version. Settings shows
a "Get the app" box: an Install button where the browser offers one (Android, desktop Chrome), or Add to Home
Screen instructions on iPhone and iPad. It is hidden once the game is running as an installed app.

## Search engines and analytics

- The search tags in `index.html` (title, description, canonical, Open Graph, structured data) and the whole
  Spanish page `es/index.html` are generated. After changing `index.html` or `i18n.js`, run `npm run pages`
  and commit the result.
- The official address is `https://www.letterlinx.com/` (English) and `/es/` (Spanish). Change `SITE` in
  `build-pages.js` if that moves.
- `robots.txt`, `sitemap.xml` and `llms.txt` describe the site to crawlers.
- Google AdSense (`ca-pub-2508666501518811`) is loaded in the head of every page, and `ads.txt` authorises it.
- Google Tag Manager (`GTM-N3VRM45M`) is loaded in the page head. The game pushes these events to the data
  layer: `round_start`, `round_end` (score, words_found, new_high_score), `language_change`, `sign_up`, `login`.

## Deploy on Vercel

1. Import this repository in Vercel and deploy. No build settings are needed.
2. In the project's **Storage** tab add **Neon** (Postgres), connect it to the project, then redeploy.
   This sets `DATABASE_URL`, which the API reads. The tables are created on the first request.

Without a database the game still plays; scores stay on each player's device and accounts are unavailable.

3. For email confirmation and password reset, add a `RESEND_API_KEY` environment variable (from resend.com) and
   verify the sending domain in Resend. Emails are sent from `LetterLinx <no-reply@letterlinx.com>`; set `EMAIL_FROM`
   to change that. Each new sign-up also sends a notice to `info@letterlinx.com`; set `SIGNUP_NOTIFY_EMAIL`
   to change the address. Without the key, accounts work but emails are never confirmed and passwords can't be reset.

## Run locally

```bash
npm install
```

```bash
DATABASE_URL=postgres://user:password@localhost:5432/letterlinx npm run dev
```

Open http://localhost:3000.

## Admin dashboard

Set `ADMIN_EMAILS` in Vercel to a comma-separated list of email addresses. A player who registers with one of
those addresses and confirms it gets an "Admin dashboard" button on the Account screen. It shows this month's
top scorer in each language (the month runs on US Eastern time), totals, and every player, with actions to
remove a player's scores or delete their account. All checks happen in `api/admin.js`.

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
- `POST /api/games` – save a finished round `{ mode, game, words, at }`; the score is recomputed on the server
- `GET | POST /api/admin` – dashboard data and actions, admins only
- `GET /api/leaderboard?mode=classic&game=101` – Linx Daily: confirmed players' best scores in that day's game
- `GET /api/leaderboard?mode=classic&variant=booster` – Brain Booster: the all-time top 10
- `GET /api/stats?mode=classic&tz=America/New_York` – the signed-in player's Brain Booster stats (played, top score, day streaks, longest word)

## Game variations

Players choose a variation on the Games screen:

- **Linx Daily** (default): the daily game described below.
- **Brain Booster**: a new random board every round. Its rounds are saved with no game number, and its
  leaderboard ranks confirmed players' all-time best.

The Leaderboard screen has a tab for each. Variations and languages are independent: each language has its
own Linx Daily and its own Brain Booster.

## Daily games

Every player gets the same letters on the same calendar day. `daily` in `modes.js` sets the first game number
(101) and the date it is played on; the number goes up by one at midnight on the player's device.

- Each column has its own repeatable letter sequence, seeded by language, game number and column. Its first
  letters fill the column top to bottom; the rest arrive in order as tiles are used.
- Players can replay a day's game. Their best score in that game is what the day's leaderboard ranks.
- `games.game` stores the game number. Rounds saved before daily games have no number and are not ranked.
- On a wide screen the same board is drawn turned on its side, so it is identical in both orientations.

## Game versions and languages

Each entry in `modes` in `modes.js` is a game version with its own top 5, leaderboard and score
history (stored under its key in `games.mode`). Today there are two, one per word language:
`classic` (English) and `es` (Español). Players choose on the first tour slide and in Settings.

A version sets the grid, round length, minimum word length, points table, word list file,
alphabet and how often each letter is dealt. To add a language, add a word list file that sets a
global variable (see `words-es.js`) and a new entry in `modes.js`. Word lists are downloaded only
when their language is chosen. Rules beyond those settings need new code in `index.html`.

The interface text, including the confirmation and reset emails, follows the word language. All of it
lives in `i18n.js`; a new language needs a matching block there. In Spanish the game is named
"Letra Linx".

## Word lists

Both lists come from MIT-licensed packages by Zeke Sikelianos, each described as derived from the
Letterpress word list: `an-array-of-english-words` and `an-array-of-spanish-words`. Their licence
text is in `THIRD-PARTY-NOTICES.md`.
