// Admin dashboard. Only signed-in players whose confirmed email is listed in ADMIN_EMAILS get in.
// GET  /api/admin                       -> totals, this month's top scorer per language, every player
// POST /api/admin { action, id }        -> "clear_scores" or "delete_player"
const L = require("./_lib.js");
const ZONE = "America/New_York"; // the month runs on US Eastern time

module.exports = L.route(async (req, res, p) => {
  const me = await L.currentPlayer(req, p);
  if (!me) return res.status(401).json({ error: "signed_out" });
  if (!L.isAdmin(me)) return res.status(403).json({ error: "forbidden", reason: L.adminProblem(me) });

  if (req.method === "GET") {
    const [totals, players, bests, month] = await Promise.all([
      p.query(`select
          (select count(*) from players)::int as players,
          (select count(*) from players where email_verified)::int as confirmed,
          (select count(*) from players where created_at > now() - interval '7 days')::int as players_7d,
          (select count(*) from games)::int as rounds,
          (select count(*) from games where played_at > now() - interval '7 days')::int as rounds_7d,
          (select count(*) from players where email_opt_in and email_verified)::int as subscribers`),
      p.query(`select pl.id, pl.screen_name, pl.first_name, pl.last_name, pl.email, pl.email_verified, pl.email_opt_in, pl.created_at,
                      count(g.id)::int as rounds, max(g.played_at) as last_played
                 from players pl left join games g on g.player_id = pl.id
                group by pl.id order by pl.created_at desc limit 2000`),
      p.query("select player_id, mode, max(score)::int as best from games group by player_id, mode"),
      // best single round of the current calendar month, one row per language
      p.query(`select distinct on (g.mode) g.mode, g.score, g.words, g.played_at,
                      pl.screen_name, pl.first_name, pl.last_name, pl.email, pl.email_verified
                 from games g join players pl on pl.id = g.player_id
                where g.played_at >= date_trunc('month', now() at time zone '${ZONE}') at time zone '${ZONE}'
                order by g.mode, g.score desc, g.played_at asc`),
    ]);
    const bestOf = {};
    for (const b of bests.rows) (bestOf[b.player_id] = bestOf[b.player_id] || {})[b.mode] = b.best;
    const person = (x) => ({ screenName: x.screen_name, first: x.first_name, last: x.last_name, email: x.email, confirmed: x.email_verified });
    return res.status(200).json({
      totals: totals.rows[0],
      month: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: ZONE }).format(new Date()),
      leaders: month.rows.map((x) => ({ mode: x.mode, modeName: (L.modes[x.mode] || {}).name || x.mode, score: x.score,
        words: Array.isArray(x.words) ? x.words.length : 0, at: new Date(x.played_at).getTime(), ...person(x) })),
      modes: Object.keys(L.modes).map((id) => ({ id, name: L.modes[id].name })),
      players: players.rows.map((x) => ({ id: x.id, ...person(x), joined: new Date(x.created_at).getTime(), rounds: x.rounds,
        lastPlayed: x.last_played ? new Date(x.last_played).getTime() : null, optIn: x.email_opt_in, best: bestOf[x.id] || {}, admin: L.isAdminEmail(x.email) })),
    });
  }

  if (req.method === "POST") {
    const b = L.body(req);
    const r = await p.query("select * from players where id::text = $1", [String(b.id || "")]);
    const target = r.rows[0];
    if (!target) return res.status(404).json({ error: "not_found" });
    if (b.action === "clear_scores") {
      const d = await p.query("delete from games where player_id = $1", [target.id]);
      return res.status(200).json({ ok: true, removed: d.rowCount });
    }
    if (b.action === "delete_player") {
      if (L.isAdminEmail(target.email)) return res.status(400).json({ error: "is_admin" }); // admins delete their own account from the Account screen
      await p.query("delete from players where id = $1", [target.id]);
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "bad_request" });
  }
  return res.status(405).json({ error: "method_not_allowed" });
});
