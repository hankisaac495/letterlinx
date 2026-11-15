// GET /api/leaderboard?mode=classic  -> every registered player with their best score in that game version
const L = require("./_lib.js");

module.exports = L.route(async (req, res, p) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const mode = L.modes[req.query && req.query.mode] ? req.query.mode : "classic";
  const r = await p.query(
    `select pl.screen_name, coalesce(max(g.score), 0)::int as best
       from players pl left join games g on g.player_id = pl.id and g.mode = $1
      group by pl.id order by best desc, pl.screen_name limit 500`, [mode]);
  return res.status(200).json({ mode, players: r.rows.map((x) => ({ screenName: x.screen_name, best: x.best })) });
});
