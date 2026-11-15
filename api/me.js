// GET /api/me     -> signed-in player's profile and top rounds
// PATCH /api/me   -> update first name, last name, email
// DELETE /api/me  -> delete the account and every saved round
const L = require("./_lib.js");

module.exports = L.route(async (req, res, p) => {
  const player = await L.currentPlayer(req, p);
  if (!player) return res.status(401).json({ error: "signed_out" });

  if (req.method === "GET") return res.status(200).json(await L.profile(p, player));

  if (req.method === "PATCH") {
    const b = L.body(req), email = L.clean(b.email, 120);
    if (!L.EMAIL.test(email)) return res.status(400).json({ error: "bad_email" });
    try {
      // a changed email has to be confirmed again
      const changed = email.toLowerCase() !== player.email.toLowerCase();
      const r = await p.query(
        "update players set first_name = $1, last_name = $2, email = $3, email_verified = email_verified and not $5 where id = $4 returning *",
        [L.clean(b.first, 40), L.clean(b.last, 40), email, player.id, changed]);
      let emailSent = true;
      if (changed && L.MAIL_ON) {
        await p.query("delete from email_codes where player_id = $1", [player.id]);
        emailSent = (await L.sendCode(p, r.rows[0], "verify", b.lang)) === "sent";
      }
      return res.status(200).json({ ...(await L.profile(p, r.rows[0])), emailSent });
    } catch (e) {
      if (e.code === "23505") return res.status(409).json({ error: "email_taken" });
      throw e;
    }
  }

  if (req.method === "DELETE") {
    await p.query("delete from players where id = $1", [player.id]); // sessions and games go with it
    await L.endSession(req, res, p);
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ error: "method_not_allowed" });
});
