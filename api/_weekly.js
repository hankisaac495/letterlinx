// The weekly stats email: gathers one player's week and the week's top scores, and renders the email.
const L = require("./_lib.js");
const SITE = process.env.SITE_URL || "https://www.letterlinx.com";
const ZONE = "America/New_York";
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TEXT = {
  en: {
    subjectPlayed: "Your LetterLinx week: {rounds} rounds, best score {best}",
    subjectIdle: "Your weekly LetterLinx: Game #{game} is waiting",
    hi: "Hi {name},", introPlayed: "Here's your week in LetterLinx.", introIdle: "You didn't play this week, and the letters miss you.",
    rounds: "Rounds played", days: "Days played", daily: "Best Linx Daily", booster: "Best Brain Booster", longest: "Longest word",
    champs: "This week's top scores", champDaily: "Linx Daily", champBooster: "Brain Booster", by: "by", game: "Game #{game}",
    remind: "Today's Linx Daily is Game #{game}. Everyone gets the same letters. Can you top the leaderboard?",
    play: "Play now", why: "You're getting this because you asked for weekly stats and offers from LetterLinx.",
    unsub: "Unsubscribe", orAccount: "or change this on the Account tab.", made: "LetterLinx is made by Literacy Advocates and 495 Digital.",
    home: "/",
  },
  es: {
    subjectPlayed: "Tu semana en Letra Linx: {rounds} rondas, mejor puntuación {best}",
    subjectIdle: "Tu Letra Linx semanal: el Juego #{game} te espera",
    hi: "Hola, {name}:", introPlayed: "Este es tu resumen de la semana en Letra Linx.", introIdle: "Esta semana no jugaste, y las letras te extrañan.",
    rounds: "Rondas jugadas", days: "Días jugados", daily: "Mejor Linx Diario", booster: "Mejor Brain Booster", longest: "Palabra más larga",
    champs: "Las mejores puntuaciones de la semana", champDaily: "Linx Diario", champBooster: "Brain Booster", by: "de", game: "Juego #{game}",
    remind: "El Linx Diario de hoy es el Juego #{game}. Todos tienen las mismas letras. ¿Puedes llegar a lo más alto de la clasificación?",
    play: "Jugar ahora", why: "Recibes este correo porque pediste estadísticas semanales y ofertas de Letra Linx.",
    unsub: "Darse de baja", orAccount: "o cámbialo en la pestaña Cuenta.", made: "Letra Linx es una creación de Literacy Advocates y 495 Digital.",
    home: "/es/",
  },
};
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m));

// ISO week, e.g. "2026-W47": one send per player per week, even if the job runs twice
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return y + "-W" + String(w).padStart(2, "0");
}

// the week's best scores among confirmed players, per language
async function champions(p, mode) {
  const top = async (daily) => (await p.query(
    `select g.score, g.game, pl.screen_name from games g join players pl on pl.id = g.player_id
      where g.mode = $1 and g.game is ${daily ? "not " : ""}null and g.played_at > now() - interval '7 days' and (pl.email_verified or not $2)
      order by g.score desc, g.played_at asc limit 1`, [mode, L.MAIL_ON])).rows[0] || null;
  return { daily: await top(true), booster: await top(false) };
}

// one player's last seven days in the language they play
async function playerWeek(p, player, mode) {
  const s = (await p.query(
    `select count(*)::int as rounds,
            count(distinct (played_at at time zone '${ZONE}')::date)::int as days,
            coalesce(max(score) filter (where game is not null), 0)::int as daily,
            coalesce(max(score) filter (where game is null), 0)::int as booster
       from games where player_id = $1 and mode = $2 and played_at > now() - interval '7 days'`, [player.id, mode])).rows[0];
  const w = (await p.query(
    `select w from games g, jsonb_array_elements_text(g.words) w
      where g.player_id = $1 and g.mode = $2 and g.played_at > now() - interval '7 days' order by length(w) desc, g.played_at asc limit 1`, [player.id, mode])).rows[0];
  return { ...s, longest: w ? w.w : "" };
}

function render(player, week, champs, opts) {
  const lang = L.langOf(player.lang), T = TEXT[lang], game = L.gameNumberUTC(Date.now());
  const name = player.first_name || player.screen_name, played = week.rounds > 0;
  const best = Math.max(week.daily, week.booster);
  const subject = played ? fill(T.subjectPlayed, { rounds: week.rounds, best }) : fill(T.subjectIdle, { game });
  const playUrl = SITE + T.home + "?utm_source=weekly_email&utm_medium=email&utm_campaign=weekly_stats";
  const unsubUrl = SITE + "/api/unsubscribe?t=" + player.unsub_token;
  const address = process.env.EMAIL_POSTAL_ADDRESS || "350 Beverly Road, Suite 115-450, McLean, VA 22101";   // required in emails with offers

  // HTML: tables and inline styles, which every mail app understands
  const font = "font-family:Nunito,'Segoe UI',Helvetica,Arial,sans-serif;";
  const stat = (n, label) => `<td width="50%" style="padding:6px;"><div style="background:#E7EFF2;border-radius:12px;padding:14px 10px;text-align:center;">
      <div style="${font}font-size:28px;font-weight:900;color:#10303B;line-height:1.1;">${esc(n)}</div>
      <div style="${font}font-size:13px;color:#4B6772;margin-top:4px;">${esc(label)}</div></div></td>`;
  const champ = (label, c, daily) => c ? `<tr><td style="padding:8px 0;border-top:1px solid #DCE6EA;${font}font-size:15px;color:#10303B;">
      <strong>${esc(label)}</strong>${daily ? ` <span style="color:#4B6772;">· ${esc(fill(T.game, { game: c.game }))}</span>` : ""}<br>
      <span style="color:#4B6772;">${esc(T.by)}</span> <strong>${esc(c.screen_name)}</strong></td>
      <td align="right" style="padding:8px 0;border-top:1px solid #DCE6EA;${font}font-size:24px;font-weight:900;color:#0C6B7A;">${esc(c.score)}</td></tr>` : "";
  const champRows = champ(T.champDaily, champs.daily, true) + champ(T.champBooster, champs.booster, false);
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#E7EFF2;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(fill(T.remind, { game }))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E7EFF2;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:18px;">
  <tr><td align="center" style="padding:28px 24px 8px;">
    <img src="${SITE}/${lang === "es" ? "email-logo-es.png" : "email-logo.png"}" width="${lang === "es" ? 207 : 212}" height="48" alt="${lang === "es" ? "Letra Linx" : "LetterLinx"}"
      style="display:block;border:0;outline:none;height:48px;width:auto;${font}font-size:22px;font-weight:900;color:#10303B;">
  </td></tr>
  <tr><td style="padding:16px 28px 4px;${font}color:#10303B;">
    <p style="margin:0 0 6px;font-size:18px;font-weight:800;">${esc(fill(T.hi, { name }))}</p>
    <p style="margin:0;font-size:16px;color:#4B6772;">${esc(played ? T.introPlayed : T.introIdle)}</p>
  </td></tr>
  ${played ? `<tr><td style="padding:12px 22px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>${stat(week.rounds, T.rounds)}${stat(week.days + "/7", T.days)}</tr>
    <tr>${stat(week.daily, T.daily)}${stat(week.booster, T.booster)}</tr></table></td></tr>
  ${week.longest ? `<tr><td style="padding:6px 28px 0;"><div style="background:#FFF6DC;border-radius:12px;padding:12px 16px;${font}color:#10303B;">
    <span style="font-size:13px;color:#4B6772;">${esc(T.longest)}</span><br><span style="font-size:24px;font-weight:900;letter-spacing:3px;text-transform:uppercase;">${esc(week.longest)}</span></div></td></tr>` : ""}` : ""}
  ${champRows ? `<tr><td style="padding:22px 28px 0;"><p style="margin:0 0 6px;${font}font-size:16px;font-weight:900;color:#10303B;">${esc(T.champs)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${champRows}</table></td></tr>` : ""}
  <tr><td align="center" style="padding:24px 28px 8px;${font}font-size:16px;color:#10303B;line-height:1.5;">${esc(fill(T.remind, { game }))}</td></tr>
  <tr><td align="center" style="padding:8px 28px 30px;">
    <a href="${esc(playUrl)}" style="display:inline-block;background:#F2A900;color:#2B1E00;${font}font-size:18px;font-weight:900;text-decoration:none;padding:14px 38px;border-radius:14px;border-bottom:4px solid #916500;">${esc(T.play)}</a>
  </td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;"><tr><td align="center" style="padding:16px 20px;${font}font-size:12px;color:#4B6772;line-height:1.6;">
  ${esc(T.why)} <a href="${esc(unsubUrl)}" style="color:#0C6B7A;">${esc(T.unsub)}</a> ${esc(T.orAccount)}<br>${esc(T.made)}${address ? "<br>" + esc(address) : ""}
</td></tr></table>
</td></tr></table></body></html>`;

  const lines = [fill(T.hi, { name }), "", played ? T.introPlayed : T.introIdle, ""];
  if (played) lines.push(`${T.rounds}: ${week.rounds}`, `${T.days}: ${week.days}/7`, `${T.daily}: ${week.daily}`, `${T.booster}: ${week.booster}`, ...(week.longest ? [`${T.longest}: ${week.longest.toUpperCase()}`] : []), "");
  if (champs.daily || champs.booster) {
    lines.push(T.champs);
    if (champs.daily) lines.push(`${T.champDaily} (${fill(T.game, { game: champs.daily.game })}): ${champs.daily.score}, ${T.by} ${champs.daily.screen_name}`);
    if (champs.booster) lines.push(`${T.champBooster}: ${champs.booster.score}, ${T.by} ${champs.booster.screen_name}`);
    lines.push("");
  }
  lines.push(fill(T.remind, { game }), "", `${T.play}: ${playUrl}`, "", "--", T.why, `${T.unsub}: ${unsubUrl}`, T.made, ...(address ? [address] : []));
  return {
    subject, html, text: lines.join("\n"),
    headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

async function build(p, player, champsCache) {
  const mode = L.langOf(player.lang) === "es" ? "es" : "classic";
  if (!champsCache[mode]) champsCache[mode] = await champions(p, mode);
  return render(player, await playerWeek(p, player, mode), champsCache[mode]);
}

module.exports = { build, weekKey };
