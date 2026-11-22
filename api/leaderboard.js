// GET /api/leaderboard?mode=classic&game=101        -> Linx Daily: confirmed players' best scores in that day's game
// GET /api/leaderboard?mode=classic&variant=booster -> Brain Booster: confirmed players' best scores on random boards
// GET /api/leaderboard?mode=classic&winner=106      -> the winner of Linx Daily game 106: screen name, score and words
const L = require("./_lib.js");

module.exports = L.route(async (req, res, p) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const q = req.query || {};
  const mode = L.modes[q.mode] ? q.mode : "classic";
  const list = (rows) => rows.map((x) => ({ screenName: x.screen_name, best: x.best }));

  // a day's winner: the top of that game's leaderboard (same order as below), with the words of their best round
  if (q.winner != null) {
    if (!/^\d{1,6}$/.test(String(q.winner))) return res.status(400).json({ error: "bad_game" });
    const r = await p.query(
      `select pl.screen_name, g.score, g.words from games g join players pl on pl.id = g.player_id
        where g.mode = $1 and g.game = $2 and g.score > 0 and (pl.email_verified or not $3)
        order by g.score desc, g.played_at asc limit 1`, [mode, Number(q.winner), L.MAIL_ON]);
    const w = r.rows[0];
    return res.status(200).json({ mode, game: Number(q.winner),
      winner: w ? { screenName: w.screen_name, score: w.score, words: Array.isArray(w.words) ? w.words : [] } : null });
  }

  if (q.variant === "booster") {
    const r = await p.query(
      `select pl.screen_name, max(g.score)::int as best
         from games g join players pl on pl.id = g.player_id
        where g.mode = $1 and g.game is null and g.score > 0 and (pl.email_verified or not $2)
        group by pl.id order by best desc, min(g.played_at) limit 10`, [mode, L.MAIL_ON]);   // all-time top 10
    return res.status(200).json({ mode, variant: "booster", players: list(r.rows) });
  }

  const game = /^\d{1,6}$/.test(q.game || "") ? Number(q.game) : L.gameNumberUTC(Date.now());
  const r = await p.query(
    `select pl.screen_name, max(g.score)::int as best
       from games g join players pl on pl.id = g.player_id
      where g.mode = $1 and g.game = $2 and g.score > 0 and (pl.email_verified or not $3)
      group by pl.id order by best desc, min(g.played_at) limit 500`, [mode, game, L.MAIL_ON]);
  return res.status(200).json({ mode, variant: "daily", game, players: list(r.rows) });
});
