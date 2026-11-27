// GET /api/leaderboard?mode=classic&game=101        -> Linx Daily: confirmed players' best scores in that day's game
// GET /api/leaderboard?mode=classic&variant=booster -> Brain Booster: confirmed players' best scores this month (US Eastern)
// GET /api/leaderboard?mode=classic&winner=106      -> the top 3 of Linx Daily game 106: screen names, scores and words
const L = require("./_lib.js");
const P = require("./_prize.js");

module.exports = L.route(async (req, res, p) => {
  if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });
  const q = req.query || {};
  const mode = L.modes[q.mode] ? q.mode : "classic";
  // react: whether this player accepts preset reactions
  const list = (rows) => rows.map((x) => ({ screenName: x.screen_name, best: x.best, react: x.reactions_on !== false }));

  // a day's winners: the top 3 players of that game's leaderboard (same order as below), each with the words of their best round
  if (q.winner != null) {
    if (!/^\d{1,6}$/.test(String(q.winner))) return res.status(400).json({ error: "bad_game" });
    const r = await p.query(
      `select screen_name, score, words, reactions_on from (
         select distinct on (g.player_id) pl.screen_name, pl.reactions_on, g.score, g.words, g.played_at
           from games g join players pl on pl.id = g.player_id
          where g.mode = $1 and g.game = $2 and g.score > 0 and (pl.email_verified or not $3)
          order by g.player_id, g.score desc, g.played_at asc) best
        order by score desc, played_at asc limit 3`, [mode, Number(q.winner), L.MAIL_ON]);
    const winners = r.rows.map((w) => ({ screenName: w.screen_name, score: w.score, words: Array.isArray(w.words) ? w.words : [], react: w.reactions_on !== false }));
    return res.status(200).json({ mode, game: Number(q.winner), winners, winner: winners[0] || null });
  }

  if (q.variant === "booster") {
    const r = await p.query(
      `select pl.screen_name, pl.reactions_on, max(g.score)::int as best
         from games g join players pl on pl.id = g.player_id
        where g.mode = $1 and g.game is null and g.score > 0 and (pl.email_verified or not $2) and ${P.inMonth("g.played_at", "$3")}
        group by pl.id order by best desc, min(g.played_at) limit 10`, [mode, L.MAIL_ON, P.monthOf()]);   // this month's top 10: it starts over on the 1st
    return res.status(200).json({ mode, variant: "booster", month: P.monthOf(), players: list(r.rows) });
  }

  const game = /^\d{1,6}$/.test(q.game || "") ? Number(q.game) : L.gameNumberUTC(Date.now());
  const r = await p.query(
    `select pl.screen_name, pl.reactions_on, max(g.score)::int as best
       from games g join players pl on pl.id = g.player_id
      where g.mode = $1 and g.game = $2 and g.score > 0 and (pl.email_verified or not $3)
      group by pl.id order by best desc, min(g.played_at) limit 10`, [mode, game, L.MAIL_ON]);   // the day's top 10
  return res.status(200).json({ mode, variant: "daily", game, players: list(r.rows) });
});
