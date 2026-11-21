// Linx WordFinder on the server: today's puzzle, plays, checking finds, timing, leaderboard and stats.
// The browser gets the board only after GO, and the words only once the puzzle is solved.
const crypto = require("crypto");
const W = require("../wordfinder.js");
const SAMPLES = require("./_wf_samples.js");
const L = require("./_lib.js");

const PEN = W.LIMITS.penaltyMs, COLS = W.LIMITS.cols, ROWS = W.LIMITS.rows, COUNT = W.LIMITS.words;
const DEVICE = "llx_wfg";
// dragging out six words takes a person well over this; faster solves are kept but not ranked
const MIN_MS = 5000;

const utcToday = () => new Date().toISOString().slice(0, 10);
// a player's local date may be a day either side of the UTC date, never further, and never before launch
function dayOk(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "") || isNaN(Date.parse(day + "T00:00:00Z"))) return false;
  return day >= W.LAUNCH && Math.abs(W.numberOf(day) - W.numberOf(utcToday())) <= 1;
}
// any past day can be looked up on the leaderboard
const pastOk = (day) => /^\d{4}-\d{2}-\d{2}$/.test(day || "") && !isNaN(Date.parse(day + "T00:00:00Z")) && day >= W.LAUNCH && W.numberOf(day) <= W.numberOf(utcToday()) + 1;

/* the device cookie: a random value that lets guests keep one attempt per day */
function readDevice(req) {
  const m = /(?:^|;\s*)llx_wfg=([0-9a-f]{32})/.exec(req.headers.cookie || "");
  return m ? m[1] : null;
}
function device(req, res, create) {
  let v = readDevice(req);
  if (!v && create) {
    v = crypto.randomBytes(16).toString("hex");
    const prev = res.getHeader("set-cookie");
    const c = `${DEVICE}=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${400 * 86400}`;
    res.setHeader("set-cookie", prev ? [].concat(prev, c) : c);
  }
  return v ? L.sha("wf:" + v) : null;
}

/* puzzles */
function fromSample(lang, day) {
  const n = W.numberOf(day) - 1, s = SAMPLES[((n % SAMPLES.length) + SAMPLES.length) % SAMPLES.length], p = s[lang];
  return { topic: p.topic, difficulty: s.difficulty, words: p.words, seed: s.id + ":" + lang };
}
const storedWords = (words) => words.map((w) => { const n = W.normalizeWord(w.word); return { word: w.word, hint: w.hint, display: n.display, key: n.key }; });

// the approved puzzle for a day; otherwise the oldest puzzle in the backup pool takes the day; otherwise a sample
async function puzzleFor(p, lang, day) {
  const get = async () => (await p.query("select * from wf_puzzles where lang = $1 and day = $2 and status = 'approved'", [lang, day])).rows[0];
  let row = await get();
  if (row) return row;
  try {
    const r = await p.query(
      `update wf_puzzles set day = $2, status = 'approved', source = source || ' (backup)', updated_at = now()
        where id = (select id from wf_puzzles where lang = $1 and status = 'backup' order by created_at, id limit 1 for update skip locked)
        returning *`, [lang, day]);
    if (r.rows[0]) return r.rows[0];
  } catch (e) { if (e.code !== "23505") throw e; }          // another request filled the day first
  const s = fromSample(lang, day), b = W.generateBoard(s.words, lang, s.seed);
  if (!b.ok) throw new Error("sample board failed: " + b.error);
  await p.query(
    `insert into wf_puzzles (lang, day, topic, difficulty, words, grid, paths, seed, status, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'approved', 'sample') on conflict do nothing`,
    [lang, day, s.topic, s.difficulty, JSON.stringify(storedWords(s.words)), JSON.stringify(b.grid), JSON.stringify(b.paths), b.seed]);
  return get();
}

/* plays */
const PLAY = "select w.*, (extract(epoch from now() - w.started_at) * 1000)::bigint as elapsed from wf_plays w";
async function findPlay(p, lang, day, me, dev) {
  if (me) {
    let r = await p.query(PLAY + " where lang = $1 and day = $2 and player_id = $3", [lang, day, me.id]);
    if (r.rows[0]) return r.rows[0];
    if (!dev) return null;
    // a game started on this device before signing in becomes the player's
    r = await p.query(
      `update wf_plays set player_id = $4, nickname = null where id = (
         select id from wf_plays where lang = $1 and day = $2 and device = $3 and player_id is null limit 1)
       returning id`, [lang, day, dev, me.id]);
    if (!r.rows[0]) return null;
    return (await p.query(PLAY + " where id = $1", [r.rows[0].id])).rows[0];
  }
  if (!dev) return null;
  // signed out: anything played on this device that day counts as the attempt
  return (await p.query(PLAY + " where lang = $1 and day = $2 and device = $3 order by started_at limit 1", [lang, day, dev])).rows[0] || null;
}

function playView(play, puzzle) {
  if (!play) return null;
  const words = puzzle.words, done = !!play.finished_at;
  return {
    elapsed: Number(play.elapsed), found: play.found.map((f) => ({ i: f.i, path: f.path, ms: f.ms, word: words[f.i].display })),
    hints: play.hints.map((i) => ({ i, hint: words[i].hint })), done,
    baseMs: play.base_ms, totalMs: play.total_ms, nickname: play.nickname, guest: !play.player_id,
    words: done ? words.map((w) => ({ word: w.display, hint: w.hint })) : undefined,
  };
}

/* nicknames for guests: 2–20 letters, numbers, spaces, dots, dashes or underscores; not a member's screen name */
async function checkNickname(p, raw, lang) {
  const nick = String(raw || "").trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,19}$/u.test(nick)) return { error: "nick_bad" };
  if (W.blocked(nick, lang) || W.blocked(nick, "es") || W.blocked(nick.replace(/[ ._-]/g, ""), "es")) return { error: "nick_blocked" };
  const r = await p.query("select 1 from players where lower(screen_name) = lower($1)", [nick]);
  if (r.rows.length) return { error: "nick_taken" };
  return { nick };
}

/* leaderboard: fastest total time first; ties go to whoever finished first */
const ELIGIBLE = `w.finished_at is not null and not w.flagged and ((w.player_id is not null and (pl.email_verified or not $3)) or (w.player_id is null and w.nickname is not null))`;
async function leaderboard(p, lang, day, limit, mine) {
  const r = await p.query(
    `select w.id, coalesce(pl.screen_name, w.nickname) as name, w.total_ms, jsonb_array_length(w.hints) as hints
       from wf_plays w left join players pl on pl.id = w.player_id
      where w.lang = $1 and w.day = $2 and ${ELIGIBLE}
      order by w.total_ms, w.finished_at limit $4`, [lang, day, L.MAIL_ON, limit]);
  const c = await p.query(
    `select count(*)::int as n from wf_plays w left join players pl on pl.id = w.player_id where w.lang = $1 and w.day = $2 and ${ELIGIBLE}`,
    [lang, day, L.MAIL_ON]);
  const out = { players: r.rows.map((x) => ({ name: x.name, ms: x.total_ms, hints: x.hints, me: !!mine && x.id === mine.id })), total: c.rows[0].n, rank: null };
  if (mine && mine.finished_at) {
    const k = await p.query(
      `select (count(*) filter (where (w.total_ms, w.finished_at) < ($5, $6)))::int + 1 as rank, coalesce(bool_or(w.id = $4), false) as listed
         from wf_plays w left join players pl on pl.id = w.player_id where w.lang = $1 and w.day = $2 and ${ELIGIBLE}`,
      [lang, day, L.MAIL_ON, mine.id, mine.total_ms, mine.finished_at]);
    out.rank = k.rows[0].listed ? k.rows[0].rank : null;    // null: finished but not on the board (no nickname, or email not confirmed)
  }
  return out;
}

/* stats for the signed-in player (all their games) or this device (guest games) */
async function stats(p, lang, day, me, dev) {
  if (!me && !dev) return { played: 0, best: null, average: null, current: 0, max: 0 };
  const r = await p.query(
    `select to_char(day, 'YYYY-MM-DD') as day, total_ms from wf_plays
      where lang = $1 and finished_at is not null and ${me ? "player_id = $2" : "device = $2 and player_id is null"} order by day`,
    [lang, me ? me.id : dev]);
  const days = r.rows.map((x) => x.day), set = new Set(days), times = r.rows.map((x) => x.total_ms);
  let max = 0, run = 0, prev = null;
  for (const d of days) { run = prev && W.numberOf(d) === W.numberOf(prev) + 1 ? run + 1 : 1; max = Math.max(max, run); prev = d; }
  let current = 0, n = W.numberOf(day);
  if (!set.has(W.dayOf(n))) n--;                       // still alive if yesterday was the last one solved
  while (set.has(W.dayOf(n))) { current++; n--; }
  return { played: days.length, best: times.length ? Math.min(...times) : null,
    average: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null, current, max, days: days.slice(-120) };
}

module.exports = { MIN_MS, W, PEN, COLS, ROWS, COUNT, dayOk, pastOk, device, readDevice, puzzleFor, findPlay, playView, checkNickname, leaderboard, stats, PLAY };
