// Brain Booster monthly prize.
// GET  /api/prize?mode=es               -> this month's prize: { month, title, image, players, minPlayers } (players: members who
//                                           have played this month in that language; fewer than minPlayers means no prize)
// GET  /api/prize?winners=1&mode=es     -> past months' winners in one language: screen name, score and words
// Admins only:
// GET  /api/prize?admin=1               -> this and next month's prizes, and each finished month's winners with emails and status
// POST /api/prize { action: "save", month, title, image }        -> set a month's prize (image: a data: URL, at most ~700 KB)
// POST /api/prize { action: "disqualify" | "reinstate", month, mode, playerId }
// POST /api/prize { action: "notify", month, mode }              -> emails the winner and marks them notified
// POST /api/prize { action: "claim", month, mode }               -> marks the prize claimed and keeps a copy of the winner's mailing
//                                                                    address (refused without one, or if it matches last or next
//                                                                    month's winner: one household can't win two months in a row)
const L = require("./_lib.js");
const P = require("./_prize.js");
const MODES = Object.keys(L.modes);

module.exports = L.route(async (req, res, p) => {
  const q = req.method === "GET" ? req.query || {} : L.body(req);

  if (req.method === "GET" && !q.admin) {
    if (q.winners) {
      const mode = L.modes[q.mode] ? q.mode : "classic", out = [];
      const memo = new Map();
      for (const m of P.pastMonths(12)) { const w = await P.winner(p, m, mode, false, memo); if (w) out.push(w); }
      return res.status(200).json({ mode, firstMonth: P.FIRST_MONTH, current: P.monthOf(), winners: out });
    }
    const now = P.monthOf(), month = P.validMonth(q.month) ? q.month : now < P.FIRST_MONTH ? P.FIRST_MONTH : now;
    const r = (await p.query("select title, image from prizes where month = $1", [month])).rows[0];
    const players = month === now ? await P.playerCount(p, month, L.modes[q.mode] ? q.mode : "classic") : 0;
    res.setHeader("cache-control", "public, max-age=120");
    return res.status(200).json({ month, current: now, firstMonth: P.FIRST_MONTH, title: r ? r.title : "", image: r ? r.image : null,
      players, minPlayers: P.MIN_PLAYERS });
  }

  const me = await L.currentPlayer(req, p);
  if (!me) return res.status(401).json({ error: "signed_out" });
  if (!L.isAdmin(me)) return res.status(403).json({ error: "forbidden" });

  if (req.method === "GET") {
    const now = P.monthOf(), next = P.addMonths(now, 1);
    const prizes = (await p.query("select month, title, image from prizes where month = any($1)", [[now, next]])).rows;
    await P.purgeAddresses(p);
    const months = [], memo = new Map();
    for (const m of P.pastMonths(12)) {
      const row = { month: m };
      for (const mode of MODES) {
        const w = await P.winner(p, m, mode, true, memo);
        if (w && w.address) w.household = await P.sameHousehold(p, m, mode, w.address);      // { month, screenName } of a matching winner
        const marks = (await p.query(`select r.player_id, r.status, pl.screen_name from prize_results r join players pl on pl.id = r.player_id
                                       where r.month = $1 and r.mode = $2`, [m, mode])).rows;
        row[mode] = { winner: w, players: await P.playerCount(p, m, mode),
          disqualified: marks.filter((x) => x.status === "disqualified").map((x) => ({ playerId: x.player_id, screenName: x.screen_name })) };
      }
      months.push(row);
    }
    return res.status(200).json({ current: now, next, firstMonth: P.FIRST_MONTH, minPlayers: P.MIN_PLAYERS, prizes, months,
      modes: MODES.map((id) => ({ id, name: L.modes[id].name })) });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  if (q.action === "save") {
    if (!P.validMonth(q.month)) return res.status(400).json({ error: "bad_month" });
    const image = typeof q.image === "string" && q.image ? q.image : null;
    if (image && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 950000))
      return res.status(400).json({ error: "bad_image", message: "Use a PNG, JPEG or WebP image under about 700 KB." });
    await p.query(
      `insert into prizes (month, title, image, updated_at) values ($1, $2, $3, now())
       on conflict (month) do update set title = excluded.title, image = coalesce(excluded.image, prizes.image), updated_at = now()`,
      [q.month, L.clean(q.title, 120), image]);
    if (q.removeImage) await p.query("update prizes set image = null where month = $1", [q.month]);
    return res.status(200).json({ ok: true });
  }
  if (!P.validMonth(q.month) || !L.modes[q.mode]) return res.status(400).json({ error: "bad_request" });
  if (q.action === "disqualify" || q.action === "reinstate") {
    const pid = String(q.playerId || "");
    if (!/^[0-9a-f-]{36}$/i.test(pid)) return res.status(400).json({ error: "bad_player" });
    if (q.action === "disqualify") await p.query(
      `insert into prize_results (month, mode, player_id, status) values ($1, $2, $3, 'disqualified')
       on conflict (month, mode, player_id) do update set status = 'disqualified', address = null, game_id = null, updated_at = now()`, [q.month, q.mode, pid]);
    else {
      await p.query("delete from prize_results where month = $1 and mode = $2 and player_id = $3 and status = 'disqualified'", [q.month, q.mode, pid]);
      // the replacement winner steps aside unless their prize was already claimed
      await p.query("delete from prize_results where month = $1 and mode = $2 and status in ('winner', 'notified')", [q.month, q.mode]);
    }
    await P.unlock(p, q.month);      // this month's other language and next month may be decided differently now
    return res.status(200).json({ ok: true });
  }
  if (q.action === "notify") {
    const w = await P.winner(p, q.month, q.mode, true);
    if (!w) return res.status(404).json({ error: "no_winner" });
    if (!L.MAIL_ON) return res.status(503).json({ error: "mail_off", message: "Email isn't set up on this deployment." });
    const prize = (await p.query("select title from prizes where month = $1", [q.month])).rows[0];
    const player = (await p.query("select first_name, screen_name, lang from players where id = $1", [w.playerId])).rows[0];
    const es = L.langOf(player.lang) === "es", name = player.first_name || player.screen_name, mname = P.monthName(q.month, es ? "es" : "en");
    const reply = process.env.SIGNUP_NOTIFY_EMAIL || "info@letterlinx.com", site = process.env.SITE_URL || "https://www.letterlinx.com";
    const text = es
      ? `Hola, ${name}:\n\n¡Felicidades! Con ${w.score} puntos, tuviste la mejor puntuación de Brain Booster de ${mname} en Letra Linx.\n\nPremio: ${prize && prize.title ? prize.title : "el premio del mes"}\n\nPara reclamarlo, en un plazo de 14 días:\n\n1. Agrega tu dirección postal en los Estados Unidos en tu cuenta (Cuenta, en ${site}/es/). Todos los ganadores necesitan una dirección postal para recibir el premio.\n2. Responde a este correo para confirmar que tienes 18 años o más.\n\nLos premios digitales (como tarjetas de regalo electrónicas o códigos promocionales) se envían por correo electrónico; los premios físicos, a tu dirección.\n\nConsulta las reglas completas en ${site}/prizes/\n\n¡Gracias por jugar!\nEl equipo de Letra Linx\n`
      : `Hi ${name},\n\nCongratulations! With ${w.score} points, you had the top Brain Booster score on LetterLinx for ${mname}.\n\nYour prize: ${prize && prize.title ? prize.title : "this month's prize"}\n\nTo claim it, do both of these within 14 days:\n\n1. Add your US mailing address to your account (Account, at ${site}). Every winner needs a mailing address on file to receive a prize.\n2. Reply to this email to confirm that you are 18 or older.\n\nDigital prizes (such as eGift cards and promo codes) are delivered by email; physical prizes are shipped to your address.\n\nThe full rules are at ${site}/prizes/\n\nThanks for playing!\nThe LetterLinx team\n`;
    const ok = await L.sendMail(w.email, es ? `¡Ganaste el premio de Brain Booster de ${mname}!` : `You won the LetterLinx Brain Booster prize for ${mname}!`, text, { reply_to: reply });
    if (!ok) return res.status(502).json({ error: "mail_failed", message: "The email couldn't be sent. Try again shortly." });
    await p.query("update prize_results set status = 'notified', updated_at = now() where month = $1 and mode = $2 and player_id = $3 and status = 'winner'",
      [q.month, q.mode, w.playerId]);
    return res.status(200).json({ ok: true, to: w.email });
  }
  if (q.action === "claim") {
    const w = await P.winner(p, q.month, q.mode, true);
    if (!w) return res.status(404).json({ error: "no_winner" });
    const address = w.address;
    if (!address) return res.status(400).json({ error: "no_address", message: w.screenName + " hasn't added a mailing address in their account yet. Every winner needs one to receive the prize." });
    const twin = await P.sameHousehold(p, q.month, q.mode, address);
    if (twin) return res.status(409).json({ error: "same_household", message: "This address matches " + twin.screenName + ", the " +
      P.monthName(twin.month, "en") + " winner. One household can't win two months in a row, so disqualify this winner instead." });
    await p.query("update prize_results set status = 'claimed', address = $4, updated_at = now() where month = $1 and mode = $2 and player_id = $3",
      [q.month, q.mode, w.playerId, address]);
    return res.status(200).json({ ok: true });
  }
  return res.status(400).json({ error: "bad_action" });
});
