# Linx WordFinder: plan and decisions

A third LetterLinx game: a daily word hunt. Everyone gets the same static board each day (per language),
hiding 6 words on one topic. Built on the `wordfinder` branch in the phases below; each phase ends with
tests passing, a commit, and a check-in.

## Agreed decisions

| Decision | Choice |
|---|---|
| Grid | 6 × 10, same as the other games (turned on its side on wide screens) |
| Words | 6 per puzzle, single words, 3–10 letters, 45 letters total at most |
| Spanish | Ñ allowed; accents stripped for matching (PERÚ matches PERU), shown in lists |
| Hint penalty | +30 seconds per hint, shown in the results |
| Leaderboard identity | Signed-in players, or guests with a nickname that doesn't match a member's screen name |
| Attempts | One ranked attempt per puzzle per language (per account, or per device for guests); no replays |
| Archive | Not included for now |
| AI generation | Claude API (Claude Opus 5.5), key kept on the server (`ANTHROPIC_API_KEY`) |

## Where it fits

- Games tab: a third card, "Linx WordFinder". The Play tab shows whichever game is selected.
- Leaderboard tab: a third tab, "WordFinder", with the calendar for past days.
- `/wordfinder` and `/es/wordfinder` open the game directly (used by the share link).
- Admin: a "WordFinder puzzles" section in the existing admin dashboard.

## Reused from LetterLinx

Tile grid and styling (including the sideways tablet layout), drag-to-select with 8-direction adjacency and
the trail line, the sound engine (with the iPhone fixes), GO screen title card, results screen, share box,
English/Spanish text system and `/es/` page, accounts, sessions and admin access, leaderboard tabs and the
past-days calendar, Vercel API functions and the Neon Postgres database, and the page generator for
titles and link previews.

## Phases

1. Codebase review and plan (done).
2. Puzzle rules and board generator: pure functions in `wordfinder.js`, tests in `test/`.
3. Gameplay, single player and local, with a few hard-coded sample puzzles.
4. Backend and leaderboard: storage, server-side checking and timing, leaderboard, streaks and stats.
5. Sharing: share text, Web Share API and clipboard, link previews.
6. Admin area: calendar, review and edit, board preview and shuffle, approve and reject, backup pool, alerts.
7. AI month generation.
8. Polish: Spanish text, accessibility, reduced motion, animation timing, end-to-end tests.

## Setup needed later

- Phase 4: ideally a separate Neon database branch for Vercel previews, so test data stays out of the live database.
- Phase 7: `ANTHROPIC_API_KEY` in Vercel (server only).
- Launch date for puzzle #1: to be decided.
