# LetterLinx

A one-minute word hunt for phones and desktops. Drag across neighbouring tiles on a 7×11 grid to spell words.

## Files

- `index.html` – the whole game (markup, styles, script)
- `words.js` – the dictionary of valid words (about 270,000 entries)
- `api/players.js` – Vercel function behind the shared leaderboard

## Run locally

```bash
python3 -m http.server 8000
```

Open http://localhost:8000. The shared leaderboard needs the Vercel function, so locally it lists only this device's player.

## Deploy on Vercel

1. Push this folder to a GitHub repository.
2. In Vercel choose **Add New → Project**, import the repository and deploy. No build settings are needed.
3. For the shared leaderboard, open the project's **Storage** tab, add **Upstash for Redis** and connect it to the project, then redeploy. This sets `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which `api/players.js` reads.

Without step 3 the game still works; scores and the account stay on each player's device.

## What is stored where

- On the device (`localStorage`): settings, name, email, screen name, top 5 scores with their words.
- On the server (Redis): screen name and best score only.
