// Shared helpers for the LetterLinx API: database, schema, passwords, sessions.
const { Pool } = require("pg");
const crypto = require("crypto");
const { modes, pointsFor } = require("../modes.js");

const URL_ = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const COOKIE = "llx_session";
const SESSION_DAYS = 60;

const SCHEMA = `
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  first_name text not null default '',
  last_name text not null default '',
  email text not null,
  screen_name text not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists players_email_key on players (lower(email));
create unique index if not exists players_screen_name_key on players (lower(screen_name));
create table if not exists sessions (
  token_hash text primary key,
  player_id uuid not null references players (id) on delete cascade,
  expires_at timestamptz not null
);
create table if not exists games (
  id bigserial primary key,
  player_id uuid not null references players (id) on delete cascade,
  mode text not null default 'classic',
  score integer not null,
  words jsonb not null,
  played_at timestamptz not null default now(),
  unique (player_id, played_at)
);
create index if not exists games_mode_score_idx on games (mode, score desc);
create index if not exists games_player_idx on games (player_id, mode, score desc);
alter table players add column if not exists email_verified boolean not null default false;
create table if not exists email_codes (
  player_id uuid not null references players (id) on delete cascade,
  purpose text not null,              -- 'verify' or 'reset'
  code_hash text not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (player_id, purpose)
);
`;

let pool = null, ready = null;
function db() {
  if (!URL_) return null;
  if (!pool) pool = new Pool({ connectionString: URL_, max: 3 });
  return pool;
}
function schema() {
  if (!ready) ready = db().query(SCHEMA).catch((e) => { ready = null; throw e; });
  return ready;
}

// Wraps a handler: 503 when no database is configured, tables created on first use.
const route = (fn) => async (req, res) => {
  res.setHeader("cache-control", "no-store");
  const p = db();
  if (!p) return res.status(503).json({ error: "not_configured" });
  try { await schema(); await fn(req, res, p); }
  catch (e) { console.error(e); if (!res.headersSent) res.status(500).json({ error: "server_error" }); }
};

const body = (req) => {
  if (req.body && typeof req.body === "object") return req.body;
  try { return JSON.parse(req.body || "{}") || {}; } catch (e) { return {}; }
};
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

/* passwords: scrypt with a per-player salt, stored as "salt:hash" */
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(String(pw), salt, 64, (e, k) => (e ? no(e) : ok(k))));
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return salt.toString("hex") + ":" + (await scrypt(pw, salt)).toString("hex");
}
async function checkPassword(pw, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const a = await scrypt(pw, Buffer.from(salt, "hex")), b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* sessions: random token in an httpOnly cookie, only its hash is stored */
function setCookie(res, value, maxAge) {
  res.setHeader("set-cookie", `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}
function token(req) {
  if (req.cookies && req.cookies[COOKIE]) return req.cookies[COOKIE];
  const m = /(?:^|;\s*)llx_session=([^;]+)/.exec(req.headers.cookie || "");
  return m ? m[1] : null;
}
async function startSession(res, p, playerId) {
  const t = crypto.randomBytes(32).toString("hex");
  await p.query("delete from sessions where expires_at < now()");
  await p.query(`insert into sessions (token_hash, player_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha(t), playerId]);
  setCookie(res, t, SESSION_DAYS * 86400);
}
async function endSession(req, res, p) {
  const t = token(req);
  if (t) await p.query("delete from sessions where token_hash = $1", [sha(t)]);
  setCookie(res, "", 0);
}
async function currentPlayer(req, p) {
  const t = token(req);
  if (!t) return null;
  const r = await p.query(
    "select pl.* from sessions s join players pl on pl.id = s.player_id where s.token_hash = $1 and s.expires_at > now()", [sha(t)]);
  return r.rows[0] || null;
}

/* email: 6-digit codes sent through Resend. Without RESEND_API_KEY, verification is switched off. */
const MAIL_ON = !!process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.EMAIL_FROM || "LetterLinx <no-reply@letterlinx.com>";
const MAIL_URL = process.env.RESEND_API_URL || "https://api.resend.com/emails";
const CODE_MINUTES = 15, CODE_TRIES = 5;

async function sendMail(to, subject, text) {
  try {
    const r = await fetch(MAIL_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, text }),
    });
    if (!r.ok) console.error("mail failed", r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch (e) { console.error("mail failed", e.message); return false; }
}

// Tells the team inbox that someone registered. Never blocks or fails the sign-up.
const NOTIFY_TO = process.env.SIGNUP_NOTIFY_EMAIL || "info@letterlinx.com";
async function notifySignup(player, lang) {
  if (!MAIL_ON || !NOTIFY_TO) return false;
  const name = [player.first_name, player.last_name].filter(Boolean).join(" ") || "(not given)";
  return sendMail(NOTIFY_TO, `New LetterLinx sign-up: ${player.screen_name}`,
    `A new player registered on LetterLinx.\n\nScreen name: ${player.screen_name}\nName: ${name}\nEmail: ${player.email}\nLanguage: ${lang === "es" ? "Spanish" : "English"}\nTime: ${new Date().toUTCString()}\n\nTheir email address is not confirmed yet; they appear on the leaderboard once they enter their code.\n`);
}

// Creates and emails a code. Returns "sent", "too_soon" (one was sent under a minute ago) or "failed".
async function sendCode(p, player, purpose, lang) {
  if (!MAIL_ON) return "failed";
  const recent = await p.query(
    "select 1 from email_codes where player_id = $1 and purpose = $2 and created_at > now() - interval '60 seconds'", [player.id, purpose]);
  if (recent.rows.length) return "too_soon";
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await p.query(
    `insert into email_codes (player_id, purpose, code_hash, expires_at) values ($1, $2, $3, now() + interval '${CODE_MINUTES} minutes')
     on conflict (player_id, purpose) do update set code_hash = excluded.code_hash, attempts = 0, created_at = now(), expires_at = excluded.expires_at`,
    [player.id, purpose, sha(player.id + ":" + code)]);
  const name = player.first_name || player.screen_name;
  const mail = lang === "es"
    ? { subject: `${code} es tu código de Letra Linx`,
        text: `Hola ${name}:\n\nTu código para ${purpose === "reset" ? "restablecer tu contraseña de Letra Linx" : "confirmar tu correo en Letra Linx"} es:\n\n${code}\n\nVence en ${CODE_MINUTES} minutos. Si no lo solicitaste, puedes ignorar este correo.\n` }
    : { subject: `${code} is your LetterLinx code`,
        text: `Hi ${name},\n\nYour code to ${purpose === "reset" ? "reset your LetterLinx password" : "confirm your email for LetterLinx"} is:\n\n${code}\n\nIt expires in ${CODE_MINUTES} minutes. If you didn't ask for this, you can ignore this email.\n` };
  const ok = await sendMail(player.email, mail.subject, mail.text);
  if (!ok) await p.query("delete from email_codes where player_id = $1 and purpose = $2", [player.id, purpose]);
  return ok ? "sent" : "failed";
}

// True when the code matches; a code is used up on success and dies after CODE_TRIES wrong guesses.
async function useCode(p, playerId, purpose, code) {
  const r = await p.query(
    "update email_codes set attempts = attempts + 1 where player_id = $1 and purpose = $2 and expires_at > now() and attempts < $3 returning code_hash",
    [playerId, purpose, CODE_TRIES]);
  const row = r.rows[0];
  if (!row || row.code_hash !== sha(playerId + ":" + String(code || "").trim())) return false;
  await p.query("delete from email_codes where player_id = $1 and purpose = $2", [playerId, purpose]);
  return true;
}

/* admins: comma-separated emails in ADMIN_EMAILS. The address must be confirmed before the powers apply. */
const ADMINS = new Set((process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
const isAdminEmail = (email) => ADMINS.has(String(email || "").toLowerCase());
// why a signed-in player is not an admin, to make setup problems easy to spot
const adminProblem = (player) => !ADMINS.size ? "ADMIN_EMAILS is not set on this deployment"
  : !isAdminEmail(player.email) ? "this account's email is not in ADMIN_EMAILS"
  : "this account's email has not been confirmed with its 6-digit code";
const isAdmin = (player) => !!player && isAdminEmail(player.email) && (player.email_verified || !MAIL_ON);

/* what the page gets about the signed-in player: profile + top 5 rounds per game version */
async function profile(p, player) {
  const r = await p.query(
    `select mode, score, words, played_at from (
       select *, row_number() over (partition by mode order by score desc, played_at desc) n from games where player_id = $1
     ) g where n <= 5 order by mode, n`, [player.id]);
  const tops = {};
  for (const g of r.rows) (tops[g.mode] = tops[g.mode] || []).push({ score: g.score, words: g.words, at: new Date(g.played_at).getTime() });
  return {
    account: { first: player.first_name, last: player.last_name, email: player.email, screenName: player.screen_name,
      verified: player.email_verified || !MAIL_ON, admin: isAdmin(player) },
    tops,
  };
}

/* Save finished rounds. The score is recomputed here from the words, never taken from the browser. */
async function saveGames(p, playerId, list) {
  if (!Array.isArray(list)) return;
  for (const g of list.slice(0, 25)) {
    if (!g || !modes[g.mode] || !Array.isArray(g.words) || g.words.length > 300) continue;
    const min = modes[g.mode].minLength, max = modes[g.mode].cols * modes[g.mode].rows;
    const words = [...new Set(g.words.map((w) => String(w).toLowerCase()))];
    const abc = modes[g.mode].alphabet;
    if (!words.length || words.some((w) => w.length < min || w.length > max || [...w].some((ch) => !abc.includes(ch)))) continue;
    const score = words.reduce((s, w) => s + pointsFor(g.mode, w.length), 0);
    const now = Date.now(), at = Number(g.at) > 0 && Number(g.at) <= now + 60000 ? Number(g.at) : now;
    await p.query(
      "insert into games (player_id, mode, score, words, played_at) values ($1, $2, $3, $4, to_timestamp($5 / 1000.0)) on conflict do nothing",
      [playerId, g.mode, score, JSON.stringify(words), at]);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (s, n) => String(s == null ? "" : s).trim().slice(0, n);

module.exports = { route, body, hashPassword, checkPassword, startSession, endSession, currentPlayer, profile, saveGames, EMAIL, clean, modes, MAIL_ON, sendCode, useCode, notifySignup, isAdmin, isAdminEmail, adminProblem };
