// GET /api/stats?mode=classic&tz=America/New_York
// The signed-in player's Brain Booster stats for one language: rounds played, top score, day streaks, longest word.
// Days are counted in the player's own time zone.
const L = require("./_lib.js");

const validZone = (tz) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (e) { return false; } };

module.exports = L.route(async (req, res, p) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const me = await L.currentPlayer(req, p);
  if (!me) return res.status(401).json({ error: "signed_out" });
  const q = req.query || {};
  const mode = L.modes[q.mode] ? q.mode : "classic";
  const tz = typeof q.tz === "string" && q.tz.length < 64 && validZone(q.tz) ? q.tz : "UTC";

  const [sum, days, word] = await Promise.all([
    p.query("select count(*)::int as played, coalesce(max(score), 0)::int as top from games where player_id = $1 and mode = $2 and game is null", [me.id, mode]),
    p.query(`select distinct to_char(played_at at time zone $3, 'YYYY-MM-DD') as d from games
              where player_id = $1 and mode = $2 and game is null order by d`, [me.id, mode, tz]),
    p.query(`select w from games g, jsonb_array_elements_text(g.words) w
              where g.player_id = $1 and g.mode = $2 and g.game is null order by length(w) desc, g.played_at asc limit 1`, [me.id, mode]),
  ]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return res.status(200).json({ mode, played: sum.rows[0].played, top: sum.rows[0].top, days: days.rows.map((x) => x.d), today,
    longest: word.rows[0] ? word.rows[0].w : "" });
});
