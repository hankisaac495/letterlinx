// GET  /api/unsubscribe?t=TOKEN  -> turns off weekly and offer emails and shows a confirmation page
// POST /api/unsubscribe?t=TOKEN  -> the same, for mail apps' one-click "Unsubscribe" button
const L = require("./_lib.js");

const page = (lang, ok) => {
  const t = lang === "es"
    ? { title: ok ? "Te has dado de baja" : "Enlace no válido", body: ok ? "Ya no recibirás el resumen semanal ni ofertas de Letra Linx. Puedes volver a activarlos cuando quieras en la pestaña Cuenta." : "Este enlace para darse de baja no es válido. Puedes cambiar tus preferencias de correo en la pestaña Cuenta.", play: "Jugar Letra Linx", home: "/es/" }
    : { title: ok ? "You're unsubscribed" : "Link not recognised", body: ok ? "You won't get the weekly stats email or offers from LetterLinx any more. You can switch them back on any time on the Account tab." : "This unsubscribe link isn't valid. You can change your email preferences on the Account tab.", play: "Play LetterLinx", home: "/" };
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${t.title} | LetterLinx</title><link rel="stylesheet" href="/pages.css"></head><body>
<main class="wrap"><h1>${t.title}</h1><p class="lead">${t.body}</p><p><a class="play" href="${t.home}">${t.play}</a></p></main></body></html>`;
};

module.exports = L.route(async (req, res, p) => {
  const token = String((req.query && req.query.t) || "");
  const r = /^[a-f0-9]{32}$/.test(token)
    ? await p.query("update players set email_opt_in = false, opt_in_at = null where unsub_token = $1 returning lang", [token]) : { rows: [] };
  const found = r.rows[0];
  if (req.method === "POST") return res.status(found ? 200 : 404).json({ ok: !!found });
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.status(found ? 200 : 404); return res.end(page(found ? found.lang : "en", !!found));
});
