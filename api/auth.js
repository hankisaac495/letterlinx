// POST /api/auth  { action: "register" | "login" | "logout", ... }
const L = require("./_lib.js");

module.exports = L.route(async (req, res, p) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const b = L.body(req);

  if (b.action === "logout") { await L.endSession(req, res, p); return res.status(200).json({ ok: true }); }

  const email = L.clean(b.email, 120), password = String(b.password || "");
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
    return res.status(200).json(await L.profile(p, player));
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
