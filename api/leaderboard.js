// GET /api/leaderboard?mode=classic&game=101        -> Linx Daily: confirmed players' best scores in that day's game
// GET /api/leaderboard?mode=classic&variant=booster -> Brain Booster: confirmed players' best scores on random boards
const L = require("./_lib.js");

module.exports = L.route(async (req, res, p) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const q = req.query || {};
  const mode = L.modes[q.mode] ? q.mode : "classic";
  const list = (rows) => rows.map((x) => ({ screenName: x.screen_name, best: x.best }));

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
