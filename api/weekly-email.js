// Weekly stats email.
//   GET  (Vercel Cron, Authorization: Bearer CRON_SECRET)  -> sends this week's email to every opted-in, confirmed player
//   GET  ?dry=1 with the same header                        -> only counts who would get it
//   GET  ?preview=1  (signed-in admin)                      -> shows the admin's own email in the browser
//   POST { action: "test" }  (signed-in admin)              -> sends the admin's own email to their inbox
const L = require("./_lib.js");
const { build, weekKey } = require("./_weekly.js");

module.exports = L.route(async (req, res, p) => {
  const q = req.query || {}, cache = {};

  if (q.preview || req.method === "POST") {
    const me = await L.currentPlayer(req, p);
    if (!me || !L.isAdmin(me)) return res.status(403).json({ error: "forbidden" });
    const player = { ...me, lang: q.lang ? L.langOf(q.lang) : me.lang };
    const mail = await build(p, player, cache);
    if (req.method === "GET") { res.setHeader("content-type", "text/html; charset=utf-8"); res.status(200); return res.end(mail.html); }
    if (!L.MAIL_ON) return res.status(503).json({ error: "not_configured" });
    const ok = await L.sendMail(me.email, "[Test] " + mail.subject, mail.text, { html: mail.html, headers: mail.headers });
    return res.status(ok ? 200 : 502).json(ok ? { ok: true, to: me.email } : { error: "mail_failed" });
  }

  // scheduled send: only Vercel Cron (or someone holding the secret) may run it
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ error: "cron_secret_not_set" });
  if ((req.headers.authorization || "") !== "Bearer " + secret) return res.status(401).json({ error: "unauthorized" });
  if (!L.MAIL_ON) return res.status(503).json({ error: "not_configured" });

  const week = weekKey();
  const r = await p.query(
    `select pl.* from players pl
      where pl.email_opt_in and pl.email_verified
        and not exists (select 1 from weekly_sent s where s.player_id = pl.id and s.week = $1)
      order by pl.created_at`, [week]);
  if (q.dry) return res.status(200).json({ week, wouldSend: r.rows.length });

  // send in batches of 50 through the email service's batch endpoint; a player is marked sent only after their batch succeeds
  let sent = 0, failed = 0;
  for (let i = 0; i < r.rows.length; i += 50) {
    const group = r.rows.slice(i, i + 50), mails = [];
    for (const player of group) {
      try { const m = await build(p, player, cache); mails.push({ player, m }); } catch (e) { console.error("weekly email build", player.id, e.message); failed++; }
    }
    if (!mails.length) continue;
    const ok = await L.sendBatch(mails.map(({ player, m }) => ({ to: player.email, subject: m.subject, text: m.text, html: m.html, headers: m.headers })));
    if (!ok) { failed += mails.length; continue; }
    for (const { player } of mails) await p.query("insert into weekly_sent (player_id, week) values ($1, $2) on conflict do nothing", [player.id, week]);
    sent += mails.length;
  }
  return res.status(200).json({ week, sent, failed });
});
