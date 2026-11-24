// Preset reactions: registered players send each other one of a fixed set of friendly reactions about a score.
// No free text, so there is nothing to moderate.
// GET  /api/reactions                                   -> the signed-in player's reactions (newest first), unseen count, tallies per score
// POST /api/reactions { action: "send", to, kind, subject } -> react to one of `to`'s scores:
//        subject { type: "daily", mode, game } | { type: "booster", mode } | { type: "wf", lang, day }
// POST /api/reactions { action: "seen" }                 -> marks everything as seen (clears the badge)
// POST /api/reactions { action: "settings", on }         -> allow or stop reactions to this player
// POST /api/reactions { action: "mute", from }           -> hides reactions from one player
// POST /api/reactions { action: "remove", id }           -> removes one reaction from the list
// POST /api/reactions { action: "clear" }                -> removes them all
// Reactions are deleted 48 hours after they're sent.
const L = require("./_lib.js");
const W = require("../wordfinder.js");

const KINDS = ["great", "fire", "well", "brainiac", "fast", "congrats", "how", "rematch"];
const PER_DAY = 30;
const KEEP = "48 hours";
// clear out reactions older than 48 hours (cheap with the created_at index; run now and then)
const sweep = (p) => (Math.random() < 0.2 ? p.query(`delete from reactions where created_at < now() - interval '${KEEP}'`) : null);

module.exports = L.route(async (req, res, p) => {
  const me = await L.currentPlayer(req, p);
  if (!me) return res.status(401).json({ error: "signed_out" });
  const verified = me.email_verified || !L.MAIL_ON;

  if (req.method === "GET") {
    await sweep(p);
    const [list, tallies] = await Promise.all([
      p.query(
        `select r.id, pl.screen_name as "from", r.kind, r.label, r.created_at, r.seen_at from reactions r join players pl on pl.id = r.from_id
          where r.to_id = $1 and r.created_at > now() - interval '${KEEP}' and r.removed_at is null
            and not exists (select 1 from reaction_mutes m where m.player_id = $1 and m.muted_id = r.from_id)
          order by r.created_at desc limit 60`, [me.id]),
      p.query(
        `select subject, kind, count(*)::int as n from reactions r where to_id = $1 and created_at > now() - interval '${KEEP}' and removed_at is null
            and not exists (select 1 from reaction_mutes m where m.player_id = $1 and m.muted_id = r.from_id)
          group by subject, kind`, [me.id]),
    ]);
    const t = {};
    for (const x of tallies.rows) (t[x.subject] = t[x.subject] || {})[x.kind] = x.n;
    return res.status(200).json({
      on: me.reactions_on !== false, unseen: list.rows.filter((r) => !r.seen_at).length, tallies: t,
      list: list.rows.map((r) => ({ id: Number(r.id), from: r.from, kind: r.kind, label: r.label, at: new Date(r.created_at).getTime(), seen: !!r.seen_at })),
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const b = L.body(req);

  if (b.action === "remove") { await p.query("update reactions set removed_at = now() where id = $1 and to_id = $2", [Number(b.id) || 0, me.id]); return res.status(200).json({ ok: true }); }
  if (b.action === "clear") { await p.query("update reactions set removed_at = now() where to_id = $1 and removed_at is null", [me.id]); return res.status(200).json({ ok: true }); }
  if (b.action === "seen") { await p.query("update reactions set seen_at = now() where to_id = $1 and seen_at is null", [me.id]); return res.status(200).json({ ok: true }); }
  if (b.action === "settings") {
    await p.query("update players set reactions_on = $2 where id = $1", [me.id, b.on !== false]);
    return res.status(200).json({ ok: true, on: b.on !== false });
  }
  if (b.action === "mute") {
    const r = await p.query("select id from players where lower(screen_name) = lower($1)", [L.clean(b.from, 16)]);
    if (r.rows[0] && r.rows[0].id !== me.id) await p.query("insert into reaction_mutes (player_id, muted_id) values ($1, $2) on conflict do nothing", [me.id, r.rows[0].id]);
    return res.status(200).json({ ok: true });
  }
  if (b.action !== "send") return res.status(400).json({ error: "bad_action" });

  if (!verified) return res.status(403).json({ error: "unverified" });
  if (!KINDS.includes(b.kind)) return res.status(400).json({ error: "bad_kind" });
  const to = (await p.query("select * from players where lower(screen_name) = lower($1)", [L.clean(b.to, 16)])).rows[0];
  if (!to || to.id === me.id || !(to.email_verified || !L.MAIL_ON) || to.reactions_on === false) return res.status(404).json({ error: "not_available" });
  const recent = (await p.query("select count(*)::int as n from reactions where from_id = $1 and created_at > now() - interval '1 day'", [me.id])).rows[0].n;
  if (recent >= PER_DAY) return res.status(429).json({ error: "too_many" });

  // the score must be real: the receiver's own result in that game, as stored
  const s = b.subject || {};
  let subject = null, label = null;
  if (s.type === "daily" && L.modes[s.mode] && Number.isInteger(Number(s.game))) {
    const r = (await p.query("select max(score)::int as score from games where player_id = $1 and mode = $2 and game = $3", [to.id, s.mode, Number(s.game)])).rows[0];
    if (r && r.score > 0) { subject = `daily:${s.mode}:${Number(s.game)}`; label = { v: "daily", mode: s.mode, n: Number(s.game), score: r.score }; }
  } else if (s.type === "booster" && L.modes[s.mode]) {
    const r = (await p.query("select max(score)::int as score from games where player_id = $1 and mode = $2 and game is null", [to.id, s.mode])).rows[0];
    if (r && r.score > 0) { subject = `booster:${s.mode}:${r.score}`; label = { v: "booster", mode: s.mode, score: r.score }; }
  } else if (s.type === "wf" && /^\d{4}-\d{2}-\d{2}$/.test(s.day || "")) {
    const lang = L.langOf(s.lang);
    const r = (await p.query("select total_ms from wf_plays where player_id = $1 and lang = $2 and day = $3 and outcome = 'solved'", [to.id, lang, s.day])).rows[0];
    if (r) { subject = `wf:${lang}:${s.day}`; label = { v: "wf", lang, n: W.numberOf(s.day), ms: r.total_ms }; }
  }
  if (!subject) return res.status(404).json({ error: "no_score" });

  // a muted sender is told it was sent, but the receiver never sees it
  const muted = (await p.query("select 1 from reaction_mutes where player_id = $1 and muted_id = $2", [to.id, me.id])).rows.length > 0;
  const r = await p.query(
    `insert into reactions (from_id, to_id, kind, subject, label, seen_at) values ($1, $2, $3, $4, $5, $6)
     on conflict (from_id, to_id, subject) do nothing returning id`, [me.id, to.id, b.kind, subject, JSON.stringify(label), muted ? new Date() : null]);
  await sweep(p);
  if (!r.rows[0]) return res.status(409).json({ error: "already" });
  if (!muted) await p.query(
    `insert into reaction_counts (player_id, day, kind, n) values ($1, (now() at time zone 'America/New_York')::date, $2, 1)
     on conflict (player_id, day, kind) do update set n = reaction_counts.n + 1`, [to.id, b.kind]);
  return res.status(200).json({ ok: true });
});
