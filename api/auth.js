// POST /api/auth  { action: "register" | "login" | "logout" | "verify" | "resend" | "forgot" | "reset", ... }
const L = require("./_lib.js");

module.exports = L.route(async (req, res, p) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const b = L.body(req);

  if (b.action === "logout") { await L.endSession(req, res, p); return res.status(200).json({ ok: true }); }

  /* confirm the signed-in player's email with the emailed code, or send a fresh one */
  if (b.action === "verify" || b.action === "resend") {
    const me = await L.currentPlayer(req, p);
    if (!me) return res.status(401).json({ error: "signed_out" });
    if (b.action === "resend") {
      if (me.email_verified) return res.status(200).json(await L.profile(p, me));
      const sent = await L.sendCode(p, me, "verify", b.lang);
      if (sent !== "sent") return res.status(sent === "too_soon" ? 429 : 502).json({ error: sent === "too_soon" ? "too_soon" : "mail_failed" });
      return res.status(200).json({ ok: true });
    }
    if (!(await L.useCode(p, me.id, "verify", b.code))) return res.status(400).json({ error: "bad_code" });
    const r = await p.query("update players set email_verified = true where id = $1 returning *", [me.id]);
    return res.status(200).json(await L.profile(p, r.rows[0]));
  }

  const email = L.clean(b.email, 120), password = String(b.password || "");

  /* forgotten password: email a code, then swap it for a new password. Never reveals whether the email exists. */
  if (b.action === "forgot") {
    const r = await p.query("select * from players where lower(email) = lower($1)", [email]);
    if (r.rows[0]) await L.sendCode(p, r.rows[0], "reset", b.lang);
    return res.status(200).json({ ok: true });
  }
  if (b.action === "reset") {
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: "bad_password" });
    const r = await p.query("select * from players where lower(email) = lower($1)", [email]);
    const found = r.rows[0];
    if (!found || !(await L.useCode(p, found.id, "reset", b.code))) return res.status(400).json({ error: "bad_code" });
    // the code proves they own the inbox, so the email counts as confirmed; every old sign-in is ended
    const u = await p.query("update players set password_hash = $1, email_verified = true where id = $2 returning *", [await L.hashPassword(password), found.id]);
    await p.query("delete from sessions where player_id = $1", [found.id]);
    await L.saveGames(p, found.id, b.games);
    await L.startSession(res, p, found.id);
    return res.status(200).json(await L.profile(p, u.rows[0]));
  }
  if (b.action === "register") {
    const screenName = L.clean(b.screenName, 16);
    if (!L.EMAIL.test(email)) return res.status(400).json({ error: "bad_email" });
    if (!/^[A-Za-z0-9_.-]{3,16}$/.test(screenName)) return res.status(400).json({ error: "bad_name" });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: "bad_password" });
    let player;
    try {
      const r = await p.query(
        "insert into players (first_name, last_name, email, screen_name, password_hash) values ($1, $2, $3, $4, $5) returning *",
        [L.clean(b.first, 40), L.clean(b.last, 40), email, screenName, await L.hashPassword(password)]);
      player = r.rows[0];
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ error: /screen_name/.test(e.constraint || "") ? "name_taken" : "email_taken" });
      throw e;
    }
    await L.saveGames(p, player.id, b.games);
    await L.startSession(res, p, player.id);
    const emailSent = L.MAIL_ON ? (await L.sendCode(p, player, "verify", b.lang)) === "sent" : true;
    return res.status(200).json({ ...(await L.profile(p, player)), emailSent });
  }

  if (b.action === "login") {
    const r = await p.query("select * from players where lower(email) = lower($1)", [email]);
    const player = r.rows[0];
    if (!player || !(await L.checkPassword(password, player.password_hash))) return res.status(401).json({ error: "bad_credentials" });
    await L.saveGames(p, player.id, b.games);
    await L.startSession(res, p, player.id);
    return res.status(200).json(await L.profile(p, player));
  }
  return res.status(400).json({ error: "bad_request" });
});
