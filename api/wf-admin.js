// Linx WordFinder puzzle admin. Only for admins (confirmed emails listed in ADMIN_EMAILS).
// GET  /api/wf-admin?month=YYYY-MM  -> each day's puzzles (both languages), the backup pool and alerts for the next 7 days
// GET  /api/wf-admin?id=N           -> one puzzle in full
// POST /api/wf-admin { action, ... }:
//   save      { id?, lang, day? | pool: true, topic, difficulty, words: [{ word, hint }], seed } -> creates or updates (as a draft, or in the pool)
//   approve   { id }        -> a draft goes live on its day      unapprove { id } -> back to draft
//   reject    { id }        -> set aside                         backup    { id } -> into the backup pool
//   assign    { id, day }   -> a pool puzzle takes a day (approved)
//   swap      { a, b }      -> two days trade puzzles (both languages)
// Writing puzzles with Claude (needs ANTHROPIC_API_KEY; each request is one short call to stay inside the time limit):
//   ai_plan   { month }     -> a topic for every empty day of the month from today on
//   ai_day    { day, en, es, difficulty, fix?, save? } -> words and hints for one day in both languages;
//                              save: true stores them as drafts (source "ai"), otherwise they're returned for the editor
//   ai_item   { lang, topic, words, index, part: "word" | "hint" } -> a replacement word, or a new hint
const L = require("./_lib.js");
const F = require("./_wf.js");
const W = F.W;
const AI = require("./_wf_ai.js");

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (d) => DAY.test(d || "") && !isNaN(Date.parse(d + "T00:00:00Z"));
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dayText = (d) => d ? (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)) : null;
// live somewhere in the world (a player's local date can be a day ahead of UTC), or already played: no more changes
const isLocked = (row, plays) => plays > 0 || (row.status === "approved" && row.day && dayText(row.day) <= addDays(F.utcToday(), 1));

const SELECT = `select z.*, to_char(z.day, 'YYYY-MM-DD') as dayk, (select count(*)::int from wf_plays w where w.puzzle_id = z.id) as plays from wf_puzzles z`;
function summary(r) {
  return { id: Number(r.id), lang: r.lang, day: r.dayk, number: r.dayk ? W.numberOf(r.dayk) : null, topic: r.topic, difficulty: r.difficulty,
    status: r.status, source: r.source, plays: r.plays, locked: isLocked(r, r.plays), updated: new Date(r.updated_at).getTime(),
    problems: r.notes && Array.isArray(r.notes.errors) ? r.notes.errors : [] };
}
const full = (r) => ({ ...summary(r), words: r.words.map((w) => ({ word: w.word, hint: w.hint })), grid: r.grid, paths: r.paths, seed: r.seed });
async function get(p, id) { return (await p.query(SELECT + " where z.id = $1", [id])).rows[0] || null; }

function reuseDay(reuse, difficulty) {
  const out = {};
  for (const lang of ["en", "es"]) {
    const x = reuse[lang] || {}, p = x.puzzle || {};
    const puzzle = { topic: String(p.topic || "").trim().slice(0, 60), difficulty,
      words: (Array.isArray(p.words) ? p.words : []).slice(0, 8).map((w) => ({ word: String((w && w.word) || "").trim().toUpperCase().slice(0, 20), hint: String((w && w.hint) || "").trim().slice(0, 120) })) };
    const seed = String(x.seed || "").slice(0, 40) || Math.random().toString(36).slice(2, 10);
    out[lang] = { puzzle, seed, ...AI.check(puzzle, lang, seed) };
  }
  return out;
}

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
    return res.status(200).json({ month, today, launch: W.LAUNCH, ai: AI.enabled(), model: AI.MODEL, puzzles: rows.rows.map(summary), pool: pool.rows.map(summary), poolCount, alerts });
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
        await p.query(`update wf_puzzles set topic = $2, difficulty = $3, words = $4, grid = $5, paths = $6, seed = $7, status = $8, notes = null, updated_at = now()
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

  if (String(b.action || "").startsWith("ai_")) {
    try {
      if (b.action === "ai_plan") {
        const month = /^\d{4}-\d{2}$/.test(b.month || "") ? b.month : today.slice(0, 7);
        const first = month + "-01", last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
        const from = [first, today, W.LAUNCH].sort().pop();
        if (from > last) return fail(400, "past", { message: "That month has already passed." });
        const taken = (await p.query("select to_char(day, 'YYYY-MM-DD') as d, lang from wf_puzzles where day between $1 and $2 and status in ('draft', 'approved')", [from, last])).rows;
        const days = [], partial = [];
        for (let d = from; d <= last; d = addDays(d, 1)) {
          const n = taken.filter((x) => x.d === d).length;
          if (!n) days.push(d); else if (n === 1) partial.push(d);
        }
        if (!days.length) return res.status(200).json({ topics: [], partial });
        // topics from the last 90 days, the coming months and the backup pool, so nothing repeats
        const avoid = (await p.query(
          `select distinct topic from wf_puzzles where lang = 'en' and status <> 'rejected' and (status = 'backup' or day between $1 and $2)`,
          [addDays(today, -90), addDays(today, 150)])).rows.map((x) => x.topic);
        const plan = await AI.planMonth(days, avoid);
        return res.status(200).json({ topics: plan.topics, partial, usage: plan.usage });
      }
      if (b.action === "ai_day") {
        const day = b.day ? String(b.day) : null;
        if (day && (!validDay(day) || day < W.LAUNCH)) return fail(400, "bad_day");
        const save = !!b.save && !!day;
        const have = save ? (await p.query("select lang from wf_puzzles where day = $1 and status in ('draft', 'approved')", [day])).rows.map((x) => x.lang) : [];
        if (save && have.length === 2) return res.status(200).json({ skipped: true });
        const difficulty = W.DIFFICULTIES.includes(b.difficulty) ? b.difficulty : "medium";
        // reuse: a result this admin page already got from Claude (and checked) is saved without asking again; it's re-checked here
        const out = b.reuse && typeof b.reuse === "object" ? reuseDay(b.reuse, difficulty)
          : await AI.writeDay({ day, en: String(b.en || "").slice(0, 60), es: String(b.es || "").slice(0, 60),
            difficulty, fix: Array.isArray(b.fix) ? b.fix.slice(0, 12).map(String) : null });
        const result = { usage: out.usage };
        for (const lang of ["en", "es"]) {
          const x = out[lang];
          result[lang] = { ok: x.ok, errors: x.errors, warnings: x.warnings, puzzle: x.puzzle, seed: x.seed };
          if (!save || have.includes(lang)) continue;
          // saved as a draft either way; one with problems has no board and can't be approved until fixed
          const r = await p.query(
            `insert into wf_puzzles (lang, day, topic, difficulty, words, grid, paths, seed, status, source, notes)
             values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', 'ai', $9) on conflict do nothing returning id`,
            [lang, day, x.puzzle.topic || "(no topic)", x.puzzle.difficulty, JSON.stringify(F.storedWords(x.puzzle.words)),
              JSON.stringify(x.ok ? x.board.grid : []), JSON.stringify(x.ok ? x.board.paths : []), x.seed,
              JSON.stringify({ errors: x.errors, warnings: x.warnings, model: AI.MODEL })]);
          result[lang].id = r.rows[0] ? Number(r.rows[0].id) : null;
        }
        return res.status(200).json(result);
      }
      if (b.action === "ai_item") {
        const words = (Array.isArray(b.words) ? b.words : []).slice(0, 6).map((w) => ({ word: String((w && w.word) || "").slice(0, 20), hint: String((w && w.hint) || "").slice(0, 120) }));
        const index = Number(b.index);
        if (!Number.isInteger(index) || index < 0 || index >= 6) return fail(400, "bad_index");
        const r = await AI.rewriteItem({ lang: L.langOf(b.lang), topic: String(b.topic || "").slice(0, 60), words, index, part: b.part === "hint" ? "hint" : "word" });
        return res.status(200).json(r);
      }
      return fail(400, "bad_action");
    } catch (e) {
      if (e instanceof AI.AiError) return fail(e.code === "no_key" ? 503 : 502, e.code, { message: e.message });
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
      if (!Array.isArray(cur.grid) || cur.grid.length !== W.LIMITS.cols * W.LIMITS.rows) return fail(400, "no_board", { message: "This puzzle has no board yet. Open it, fix any problems and save it first." });
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
