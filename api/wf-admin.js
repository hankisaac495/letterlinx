// Linx WordFinder puzzle admin. Only for admins (confirmed emails listed in ADMIN_EMAILS).
// GET  /api/wf-admin?month=YYYY-MM  -> each day's puzzles (both languages), the backup pool and alerts for the next 7 days
// GET  /api/wf-admin?id=N           -> one puzzle in full
// POST /api/wf-admin { action, ... }:
//   save      { id?, lang, day? | pool: true, topic, difficulty, words: [{ word, hint }], seed } -> creates or updates (as a draft, or in the pool)
//   approve   { id }        -> a draft goes live on its day      unapprove { id } -> back to draft
//   reject    { id }        -> set aside                         backup    { id } -> into the backup pool
//   assign    { id, day }   -> a pool puzzle takes a day (approved)
//   swap      { a, b }      -> two days trade puzzles (both languages)
const L = require("./_lib.js");
const F = require("./_wf.js");
const W = F.W;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d) => DAY.test(d || "") && !isNaN(Date.parse(d + "T00:00:00Z"));
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dayText = (d) => d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null;
// live somewhere in the world (a player's local date can be a day ahead of UTC), or already played: no more changes
const isLocked = (row, plays) => plays > 0 || (row.status === "approved" && row.day && dayText(row.day) <= addDays(F.utcToday(), 1));

const SELECT = `select z.*, to_char(z.day, 'YYYY-MM-DD') as dayk, (select count(*)::int from wf_plays w where w.puzzle_id = z.id) as plays from wf_puzzles z`;
function summary(r) {
  return { id: Number(r.id), lang: r.lang, day: r.dayk, number: r.dayk ? W.numberOf(r.dayk) : null, topic: r.topic, difficulty: r.difficulty,
    status: r.status, source: r.source, plays: r.plays, locked: isLocked(r, r.plays), updated: new Date(r.updated_at).getTime() };
}
const full = (r) => ({ ...summary(r), words: r.words.map((w) => ({ word: w.word, hint: w.hint })), grid: r.grid, paths: r.paths, seed: r.seed });
async function get(p, id) { return (await p.query(SELECT + " where z.id = $1", [id])).rows[0] || null; }

module.exports = L.route(async (req, res, p) => {
  const me = await L.currentPlayer(req, p);
  if (!me) return res.status(401).json({ error: "signed_out" });
  if (!L.isAdmin(me)) return res.status(403).json({ error: "forbidden", reason: L.adminProblem(me) });
  const today = F.utcToday();

  if (req.method === "GET") {
    const q = req.query || {};
    if (q.id) {
      const r = await get(p, Number(q.id) || 0);
      return r ? res.status(200).json(full(r)) : res.status(404).json({ error: "not_found" });
    }
    const month = /^\d{4}-\d{2}$/.test(q.month || "") ? q.month : today.slice(0, 7);
    const first = month + "-01", last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
    const [rows, pool, soon] = await Promise.all([
      p.query(SELECT + " where z.day between $1 and $2 and z.status in ('draft', 'approved') order by z.day, z.lang", [first, last]),
      p.query(SELECT + " where z.status = 'backup' order by z.lang, z.created_at, z.id"),
      p.query("select lang, to_char(day, 'YYYY-MM-DD') as dayk, status from wf_puzzles where day between $1 and $2 and status in ('draft', 'approved')", [today, addDays(today, 6)]),
    ]);
    // alerts: each of the next 7 days (from today, UTC) needs an approved puzzle in each language
    const poolCount = { en: 0, es: 0 }; pool.rows.forEach((r) => poolCount[r.lang]++);
    const alerts = [];
    for (const lang of ["en", "es"]) {
      let left = poolCount[lang];
      for (let i = 0; i < 7; i++) {
        const d = addDays(today, i);
        if (d < W.LAUNCH) continue;
        const here = soon.rows.filter((r) => r.lang === lang && r.dayk === d);
        if (here.some((r) => r.status === "approved")) continue;
        const draft = here.some((r) => r.status === "draft");
        alerts.push({ lang, day: d, number: W.numberOf(d), draft, cover: left > 0 ? "backup" : "sample" });
        if (left > 0) left--;
      }
    }
    return res.status(200).json({ month, today, launch: W.LAUNCH, puzzles: rows.rows.map(summary), pool: pool.rows.map(summary), poolCount, alerts });
  }

  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const b = L.body(req);
  const fail = (status, error, extra) => res.status(status).json({ error, ...(extra || {}) });

  if (b.action === "save") {
    const lang = L.langOf(b.lang), pool = !!b.pool, day = pool ? null : String(b.day || "");
    if (!pool && (!validDay(day) || day < W.LAUNCH)) return fail(400, "bad_day", { message: "Pick a day on or after the launch date." });
    const input = { topic: String(b.topic || "").trim(), difficulty: W.DIFFICULTIES.includes(b.difficulty) ? b.difficulty : "medium",
      words: (Array.isArray(b.words) ? b.words : []).slice(0, 12).map((w) => ({ word: String((w && w.word) || "").trim(), hint: String((w && w.hint) || "").trim() })) };
    const v = W.validatePuzzle(input, lang);
    if (!v.ok) return fail(400, "invalid", { errors: v.errors, message: v.errors[0].message });
    const seed = String(b.seed || "").slice(0, 80) || Math.random().toString(36).slice(2, 10);
    const board = W.generateBoard(input.words, lang, seed);
    if (!board.ok) return fail(400, "no_board", { message: board.error });
    const vals = [input.topic, input.difficulty, JSON.stringify(F.storedWords(input.words)), JSON.stringify(board.grid), JSON.stringify(board.paths), seed];
    try {
      if (b.id) {
        const cur = await get(p, Number(b.id) || 0);
        if (!cur) return fail(404, "not_found");
        if (isLocked(cur, cur.plays)) return fail(409, "locked", { message: "This puzzle is live or has been played, so it can't be changed." });
        // editing an approved puzzle takes it back to draft: it has to be approved again
        const status = cur.status === "backup" ? "backup" : cur.status === "rejected" ? "rejected" : "draft";
        await p.query(`update wf_puzzles set topic = $2, difficulty = $3, words = $4, grid = $5, paths = $6, seed = $7, status = $8, updated_at = now()
                        where id = $1`, [cur.id, ...vals, status]);
        return res.status(200).json(full(await get(p, cur.id)));
      }
      const r = await p.query(
        `insert into wf_puzzles (lang, day, topic, difficulty, words, grid, paths, seed, status, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'manual') returning id`, [lang, day, ...vals, pool ? "backup" : "draft"]);
      return res.status(200).json(full(await get(p, r.rows[0].id)));
    } catch (e) {
      if (e.code === "23505") return fail(409, "taken", { message: "That day already has a draft in this language. Edit that one instead." });
      throw e;
    }
  }

  if (b.action === "swap") {
    const a = String(b.a || ""), c = String(b.b || "");
    if (!validDay(a) || !validDay(c) || a === c) return fail(400, "bad_day", { message: "Pick two different days." });
    const rows = (await p.query(SELECT + " where z.day in ($1, $2) and z.status in ('draft', 'approved')", [a, c])).rows;
    if (rows.some((r) => isLocked(r, r.plays)) || [a, c].some((d) => d <= addDays(today, 1)))
      return fail(409, "locked", { message: "Only days that haven't started anywhere yet can be swapped." });
    const client = await p.connect();
    try {
      await client.query("begin");
      // through a parking date, so the one-puzzle-per-day rule holds at every step
      await client.query("update wf_puzzles set day = '1900-01-01', updated_at = now() where day = $1 and status in ('draft', 'approved')", [a]);
      await client.query("update wf_puzzles set day = $1, updated_at = now() where day = $2 and status in ('draft', 'approved')", [a, c]);
      await client.query("update wf_puzzles set day = $1, updated_at = now() where day = '1900-01-01' and status in ('draft', 'approved')", [c]);
      await client.query("commit");
    } catch (e) { await client.query("rollback"); throw e; } finally { client.release(); }
    return res.status(200).json({ ok: true });
  }

  const cur = await get(p, Number(b.id) || 0);
  if (!cur) return fail(404, "not_found");
  const locked = isLocked(cur, cur.plays);
  const done = async () => res.status(200).json(full(await get(p, cur.id)));
  try {
    if (b.action === "approve") {
      if (cur.status !== "draft" || !cur.dayk) return fail(400, "bad_state", { message: "Only a draft with a day can be approved." });
      const v = W.validatePuzzle({ topic: cur.topic, difficulty: cur.difficulty, words: cur.words }, cur.lang);
      if (!v.ok) return fail(400, "invalid", { errors: v.errors, message: v.errors[0].message });
      if (cur.dayk < today) return fail(400, "past", { message: "That day has already passed." });
      await p.query("update wf_puzzles set status = 'approved', updated_at = now() where id = $1", [cur.id]);
      return done();
    }
    if (locked) return fail(409, "locked", { message: "This puzzle is live or has been played, so it can't be changed." });
    if (b.action === "unapprove") {
      if (cur.status !== "approved") return fail(400, "bad_state", { message: "This puzzle isn't approved." });
      await p.query("update wf_puzzles set status = 'draft', updated_at = now() where id = $1", [cur.id]);
      return done();
    }
    if (b.action === "reject") { await p.query("update wf_puzzles set status = 'rejected', updated_at = now() where id = $1", [cur.id]); return done(); }
    if (b.action === "backup") { await p.query("update wf_puzzles set status = 'backup', day = null, updated_at = now() where id = $1", [cur.id]); return done(); }
    if (b.action === "assign") {
      const d = String(b.day || "");
      if (cur.status !== "backup") return fail(400, "bad_state", { message: "Only puzzles in the backup pool can be assigned." });
      if (!validDay(d) || d < today || d < W.LAUNCH) return fail(400, "bad_day", { message: "Pick today or a later day." });
      await p.query("update wf_puzzles set status = 'approved', day = $2, updated_at = now() where id = $1", [cur.id, d]);
      return done();
    }
  } catch (e) {
    if (e.code === "23505") return fail(409, "taken", { message: "That day already has an approved puzzle in this language (perhaps one taken from the backup pool). Move it out first." });
    throw e;
  }
  return fail(400, "bad_action");
});
