// Linx WordFinder
// GET  /api/wordfinder?lang=en&day=YYYY-MM-DD             -> the day's number and topic, plus this player's game if started
// GET  /api/wordfinder?lb=1&lang=en&day=YYYY-MM-DD        -> leaderboard for a day (fastest first) and the player's stats
// POST /api/wordfinder { action: "start", lang, day, nickname? }  -> starts the clock and returns the board
// POST /api/wordfinder { action: "find", lang, day, path }        -> checks a dragged path against the hidden words
// POST /api/wordfinder { action: "hint", lang, day }              -> reveals one more hint (+30 seconds)
// POST /api/wordfinder { action: "nickname", lang, day, nickname } -> puts a guest's finished game on the leaderboard
const L = require("./_lib.js");
const F = require("./_wf.js");

module.exports = L.route(async (req, res, p) => {
  const q = req.method === "GET" ? req.query || {} : L.body(req);
  const lang = L.langOf(q.lang), day = String(q.day || "");
  const me = await L.currentPlayer(req, p);

  if (req.method === "GET" && q.lb) {
    if (!F.pastOk(day)) return res.status(400).json({ error: "bad_day" });
    const dev = F.device(req, res, false), mine = await F.findPlay(p, lang, day, me, dev);
    const [board, st] = await Promise.all([F.leaderboard(p, lang, day, 50, mine), F.stats(p, lang, day, me, dev)]);
    return res.status(200).json({ lang, day, number: F.W.numberOf(day), ...board, stats: st });
  }

  if (!F.dayOk(day)) return res.status(400).json({ error: "bad_day", today: new Date().toISOString().slice(0, 10) });
  const puzzle = await F.puzzleFor(p, lang, day);
  // a game keeps the puzzle it started with, even if the day's puzzle is swapped later
  const puzzleOf = async (play) => !play || play.puzzle_id === puzzle.id ? puzzle
    : (await p.query("select * from wf_puzzles where id = $1", [play.puzzle_id])).rows[0];
  const send = async (play, extra) => {
    const pz = await puzzleOf(play);
    const out = { lang, day, number: F.W.numberOf(day), topic: pz.topic, difficulty: pz.difficulty, cols: F.COLS, rows: F.ROWS, count: F.COUNT,
      ...(extra || {}), play: F.playView(play, pz) };
    if (play) out.grid = pz.grid;                            // the board is only sent once the clock is running
    if (play && play.finished_at) {
      out.leaderboard = await F.leaderboard(p, lang, day, 10, play);
      out.stats = await F.stats(p, lang, day, me, F.device(req, res, false));
    } else if (!play) out.stats = await F.stats(p, lang, day, me, F.device(req, res, false));
    return res.status(200).json(out);
  };

  if (req.method === "GET") return send(await F.findPlay(p, lang, day, me, F.device(req, res, false)));
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  const dev = F.device(req, res, true);
  let play = await F.findPlay(p, lang, day, me, dev);

  if (q.action === "start") {
    if (play) return send(play);                             // one attempt: an existing game carries on
    let nick = null;
    if (!me && q.nickname) { const c = await F.checkNickname(p, q.nickname, lang); nick = c.nick || null; }
    await p.query(
      `insert into wf_plays (puzzle_id, lang, day, player_id, device, nickname) values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
      [puzzle.id, lang, day, me ? me.id : null, dev, nick]);
    return send(await F.findPlay(p, lang, day, me, dev));
  }

  if (!play) return res.status(409).json({ error: "not_started" });
  const playPuzzle = await puzzleOf(play);

  if (q.action === "find") {
    if (play.finished_at) return send(play, { hit: false, done: true });
    const path = Array.isArray(q.path) ? q.path : [];
    if (path.length < F.W.LIMITS.minLen || path.length > F.W.LIMITS.maxLen || !path.every((i) => Number.isInteger(i)))
      return send(play, { hit: false });
    const spelled = F.W.spellPath(playPuzzle.grid, path, F.COLS);     // null unless every step is to a neighbouring, unused tile
    const idx = spelled ? playPuzzle.words.findIndex((w) => w.key === spelled) : -1;
    if (idx < 0) return send(play, { hit: false });
    if (play.found.some((f) => f.i === idx)) return send(play, { hit: false, already: idx });
    // the time of the find comes from the database clock; the row update keeps two quick finds from clashing
    const r = await p.query(
      `update wf_plays set found = found || jsonb_build_array(jsonb_build_object('i', $2::int, 'path', $3::jsonb,
          'ms', (extract(epoch from now() - started_at) * 1000)::int))
        where id = $1 and finished_at is null and not found @> jsonb_build_array(jsonb_build_object('i', $2::int)) returning id`,
      [play.id, idx, JSON.stringify(path)]);
    if (r.rows[0]) await p.query(
      `update wf_plays set finished_at = now(),
          base_ms = (select max((f ->> 'ms')::int) from jsonb_array_elements(found) f),
          total_ms = (select max((f ->> 'ms')::int) from jsonb_array_elements(found) f) + $2 * jsonb_array_length(hints),
          flagged = (select max((f ->> 'ms')::int) from jsonb_array_elements(found) f) < $4
        where id = $1 and finished_at is null and jsonb_array_length(found) >= $3`, [play.id, F.PEN, F.COUNT, F.MIN_MS]);
    play = (await p.query(F.PLAY + " where id = $1", [play.id])).rows[0];
    return send(play, { hit: true, i: idx });
  }

  if (q.action === "hint") {
    if (play.finished_at) return send(play);
    const open = playPuzzle.words.map((w, i) => i).filter((i) => !play.found.some((f) => f.i === i) && !play.hints.includes(i));
    if (!open.length) return send(play, { noHints: true });
    const i = open[Math.floor(Math.random() * open.length)];
    await p.query("update wf_plays set hints = hints || to_jsonb($2::int) where id = $1 and finished_at is null and not hints @> to_jsonb($2::int)", [play.id, i]);
    play = (await p.query(F.PLAY + " where id = $1", [play.id])).rows[0];
    return send(play, { hint: i });
  }

  if (q.action === "nickname") {
    if (play.player_id) return res.status(400).json({ error: "signed_in" });
    const c = await F.checkNickname(p, q.nickname, lang);
    if (c.error) return res.status(400).json({ error: c.error });
    await p.query("update wf_plays set nickname = $2 where id = $1", [play.id, c.nick]);
    play = (await p.query(F.PLAY + " where id = $1", [play.id])).rows[0];
    return send(play);
  }
  return res.status(400).json({ error: "bad_action" });
});
