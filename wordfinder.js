// Linx WordFinder: puzzle rules and board generation.
// Pure functions with no dependencies beyond the blocklist, usable in the browser (window.LLX_WF) and on the
// server (require). The same seed always produces the same board.
(function (root) {
  var BLOCK = typeof module !== "undefined" && module.exports ? require("./wordfinder-blocklist.js") : root.LLX_WF_BLOCKLIST;

  var LIMITS = { words: 6, minLen: 3, maxLen: 10, maxTotal: 45, maxHint: 80, maxTopic: 40, cols: 6, rows: 10, seedTries: 200, penaltyMs: 30000,
    timeLimitMs: 600000,   // a game ends when the clock (hint penalties included) reaches 10:00
    hintGapMs: 10000 };    // at least 10 seconds between hints
  // puzzle #1 is played on LAUNCH (a calendar date); each later day is one number higher
  var LAUNCH = "2026-11-21";
  function dayMs(day) { var p = String(day).split("-"); return Date.UTC(+p[0], p[1] - 1, +p[2]); }
  function numberOf(day) { return Math.round((dayMs(day) - dayMs(LAUNCH)) / 86400000) + 1; }
  function dayOf(n) { return new Date(dayMs(LAUNCH) + (n - 1) * 86400000).toISOString().slice(0, 10); }
  var DIFFICULTIES = ["easy", "medium", "hard"];

  // How often each letter turns up in ordinary words, used for filler (matches the main game's tile weights)
  var FREQ = {
    en: { E: 12, A: 9, I: 8, O: 8, U: 4, S: 7, T: 7, N: 6, R: 6, C: 4, H: 4, M: 4, P: 4, L: 4, D: 4, G: 3, B: 2, F: 2, Y: 2, W: 2, K: 1.5, V: 1, X: 0.5, J: 0.5, Z: 0.5, Q: 0.3 },
    es: { A: 15, E: 12, O: 8, I: 7.5, U: 3.5, S: 8, R: 7.5, N: 6, L: 4.5, C: 4.5, T: 4.5, D: 4, M: 3.5, P: 2.5, B: 2.3, G: 1.5, H: 1, F: 1, V: 1, Z: 0.8, J: 0.6, Q: 0.4, Y: 0.4, "Ñ": 0.4, X: 0.15 },
  };
  var RARE = ["Q", "X", "Z"];               // only used as filler when one of the words contains them

  /* ---------- words ---------- */

  // "Perú" -> { display: "PERÚ", key: "PERU" }. Accents are dropped for matching; Ñ is its own letter.
  function normalizeWord(raw) {
    var display = String(raw == null ? "" : raw).trim().toUpperCase();
    var key = display.replace(/Ñ/g, "\u0001").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\u0001/g, "Ñ");
    return { display: display, key: key };
  }
  var LETTERS_ONLY = /^[A-ZÑ]+$/;

  // checks one language's puzzle against the content rules; errors block approval, warnings don't
  function validatePuzzle(p, lang) {
    lang = lang === "es" ? "es" : "en";
    var errors = [], warnings = [], words = [];
    var topic = String((p && p.topic) || "").trim();
    if (!topic) errors.push({ field: "topic", message: "The topic is empty." });
    else if (topic.length > LIMITS.maxTopic) errors.push({ field: "topic", message: "The topic is longer than " + LIMITS.maxTopic + " characters." });
    if (topic && blocked(topic, lang)) errors.push({ field: "topic", message: "The topic contains a blocked word." });
    if (p && p.difficulty != null && DIFFICULTIES.indexOf(p.difficulty) < 0) errors.push({ field: "difficulty", message: "Difficulty must be easy, medium or hard." });
    var list = (p && Array.isArray(p.words)) ? p.words : [];
    if (list.length !== LIMITS.words) errors.push({ field: "words", message: "A puzzle needs exactly " + LIMITS.words + " words; this one has " + list.length + "." });
    var total = 0, seen = {};
    list.forEach(function (item, i) {
      var raw = typeof item === "string" ? item : item && item.word;
      var w = normalizeWord(raw), at = "words." + i;
      words.push(w);
      if (!w.display) { errors.push({ field: at, message: "Word " + (i + 1) + " is empty." }); return; }
      if (/\s/.test(w.display)) errors.push({ field: at, message: w.display + " has a space; only single words are allowed." });
      else if (!LETTERS_ONLY.test(w.key)) errors.push({ field: at, message: w.display + " has characters that aren't letters (hyphens, numbers or punctuation)." });
      else if (lang === "en" && w.key.indexOf("Ñ") >= 0) errors.push({ field: at, message: w.display + " uses Ñ, which is only allowed in Spanish." });
      if (w.key.length < LIMITS.minLen || w.key.length > LIMITS.maxLen) errors.push({ field: at, message: w.display + " has " + w.key.length + " letters; words need " + LIMITS.minLen + "–" + LIMITS.maxLen + "." });
      if (seen[w.key] != null) errors.push({ field: at, message: w.display + " appears twice." });
      seen[w.key] = i;
      if (blocked(w.key, lang)) errors.push({ field: at, message: w.display + " is a blocked word." });
      total += w.key.length;
      var hint = String((item && item.hint) || "").trim(), hat = "hints." + i;
      if (typeof item === "object" && item) {
        if (!hint) errors.push({ field: hat, message: "The hint for " + w.display + " is empty." });
        else {
          if (hint.length > LIMITS.maxHint) errors.push({ field: hat, message: "The hint for " + w.display + " is longer than " + LIMITS.maxHint + " characters." });
          if (w.key.length >= 3 && normalizeWord(hint).key.replace(/[^A-ZÑ]+/g, " ").split(" ").indexOf(w.key) >= 0) errors.push({ field: hat, message: "The hint for " + w.display + " gives away the word." });
          if (blocked(hint, lang)) errors.push({ field: hat, message: "The hint for " + w.display + " contains a blocked word." });
          if (/\b(starts|begins|ends) with\b|\b\d+\s*letters?\b|\b(empieza|comienza|termina) (con|por)\b|\b\d+\s*letras?\b/i.test(hint))
            warnings.push({ field: hat, message: "The hint for " + w.display + " mentions letters or length; hints should describe the word instead." });
        }
      }
    });
    if (total > LIMITS.maxTotal) errors.push({ field: "words", message: "The words total " + total + " letters; the limit is " + LIMITS.maxTotal + "." });
    words.forEach(function (a, i) { words.forEach(function (b, j) {
      if (i !== j && a.key && b.key && a.key !== b.key && b.key.indexOf(a.key) >= 0)
        warnings.push({ field: "words." + i, message: a.display + " is inside " + b.display + ", so finding one may give away the other." });
    }); });
    return { ok: errors.length === 0, errors: errors, warnings: warnings, words: words, totalLetters: total };
  }

  // true if any blocklisted word appears as a whole word in the text
  function blocked(text, lang) {
    var list = BLOCK[lang === "es" ? "es" : "en"].concat(lang === "es" ? BLOCK.en : []);
    var tokens = normalizeWord(text).key.replace(/[^A-ZÑ]+/g, " ").trim().split(" ");
    for (var i = 0; i < tokens.length; i++) if (list.indexOf(tokens[i]) >= 0) return true;
    return false;
  }

  /* ---------- seeded randomness ---------- */
  function hash(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function rng(seed) {
    var a = hash(String(seed));
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, r) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }

  /* ---------- grid helpers ---------- */
  function neighbours(i, cols, rows) {
    var out = [], r = Math.floor(i / cols), c = i % cols;
    for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      var nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) out.push(nr * cols + nc);
    }
    return out;
  }
  function adjacent(a, b, cols) { return a !== b && Math.abs(a % cols - b % cols) <= 1 && Math.abs(Math.floor(a / cols) - Math.floor(b / cols)) <= 1; }

  // the word a list of tile indices spells, or null if the path isn't a legal drag (adjacent, no tile twice)
  function spellPath(grid, path, cols) {
    cols = cols || LIMITS.cols;
    if (!Array.isArray(path) || !path.length) return null;
    var used = {}, s = "";
    for (var k = 0; k < path.length; k++) {
      var i = path[k];
      if (typeof i !== "number" || i < 0 || i >= grid.length || used[i] || (k && !adjacent(path[k - 1], i, cols))) return null;
      used[i] = true; s += grid[i];
    }
    return s;
  }

  // any path on the board that spells the word (accents ignored), or null
  function findPath(grid, word, cols, rows) {
    cols = cols || LIMITS.cols; rows = rows || LIMITS.rows;
    var key = normalizeWord(word).key, path = [], used = {};
    function go(i, k) {
      if (grid[i] !== key[k] || used[i]) return false;
      used[i] = true; path.push(i);
      if (k === key.length - 1) return true;
      var n = neighbours(i, cols, rows);
      for (var j = 0; j < n.length; j++) if (go(n[j], k + 1)) return true;
      used[i] = false; path.pop(); return false;
    }
    for (var i = 0; i < grid.length; i++) if (go(i, 0)) return path.slice();
    return null;
  }

  /* ---------- board generation ---------- */

  // Places every word as a connected path (sharing tiles where letters match), then fills the rest.
  // Returns { ok: true, grid, paths, seed, shared, filler } or { ok: false, error, word }.
  function generateBoard(words, lang, seed, opts) {
    lang = lang === "es" ? "es" : "en"; opts = opts || {};
    var cols = opts.cols || LIMITS.cols, rows = opts.rows || LIMITS.rows, size = cols * rows, tries = opts.tries || LIMITS.seedTries;
    var keys = words.map(function (w) { return normalizeWord(typeof w === "string" ? w : w.word).key; });
    var bad = keys.filter(function (k) { return !LETTERS_ONLY.test(k); });
    if (bad.length) return { ok: false, error: "These words can't go on a board: " + bad.join(", ") + ".", word: bad[0] };
    var tooLong = keys.filter(function (k) { return k.length > size; });
    if (tooLong.length) return { ok: false, error: tooLong[0] + " is longer than the board has tiles.", word: tooLong[0] };
    // longest first, so the hardest words get the most room
    var order = keys.map(function (k, i) { return i; }).sort(function (a, b) { return keys[b].length - keys[a].length || a - b; });
    var stuck = {}, base = seed == null ? "llx" : String(seed);
    for (var t = 0; t < tries; t++) {
      var s = t === 0 ? base : base + "#" + t, r = rng(s);
      var placed = placeAll(keys, order, cols, rows, r, stuck);
      if (!placed) continue;
      var fill = fillBoard(placed.grid, placed.paths, keys, lang, cols, rows, s);
      if (!fill) continue;
      var shared = 0, count = {};
      placed.paths.forEach(function (p) { p.forEach(function (i) { count[i] = (count[i] || 0) + 1; }); });
      for (var i in count) if (count[i] > 1) shared++;
      return { ok: true, grid: fill.grid, paths: placed.paths, seed: s, shared: shared, filler: fill.filler, cols: cols, rows: rows };
    }
    var worst = Object.keys(stuck).sort(function (a, b) { return stuck[b] - stuck[a]; })[0];
    return { ok: false, word: worst || null,
      error: "No board found after " + tries + " tries." + (worst ? " " + worst + " is the hardest to place; try a shorter or different word." : "") };
  }

  // seeded backtracking: each word in turn, trying candidate paths until all fit
  function placeAll(keys, order, cols, rows, r, stuck) {
    var size = cols * rows, grid = new Array(size).fill(""), uses = new Array(size).fill(0), paths = new Array(keys.length), budget = 4000;
    function candidates(key) {
      // starting tiles: empty ones, or ones already showing the right letter (sharing), sharing first more often
      var starts = [];
      for (var i = 0; i < size; i++) if (!grid[i] || grid[i] === key[0]) starts.push(i);
      shuffle(starts, r);
      starts.sort(function (a, b) { return (grid[b] === key[0]) - (grid[a] === key[0]); });
      return starts;
    }
    function trace(key, k, i, path, onPath, found, max) {
      if (found.length >= max || --budget < 0) return;
      path.push(i); onPath[i] = true;
      if (k === key.length - 1) found.push(path.slice());
      else {
        var n = shuffle(neighbours(i, cols, rows), r).filter(function (j) { return !onPath[j] && (!grid[j] || grid[j] === key[k + 1]); });
        n.sort(function (a, b) { return (grid[b] === key[k + 1]) - (grid[a] === key[k + 1]); });
        for (var x = 0; x < n.length && found.length < max; x++) trace(key, k + 1, n[x], path, onPath, found, max);
      }
      path.pop(); onPath[i] = false;
    }
    function place(depth) {
      if (depth === order.length) return true;
      var w = order[depth], key = keys[w], options = [], starts = candidates(key);
      for (var s = 0; s < starts.length && options.length < 12 && budget > 0; s++) trace(key, 0, starts[s], [], {}, options, options.length + 2);
      for (var o = 0; o < options.length; o++) {
        var p = options[o];
        p.forEach(function (i, k) { if (!uses[i]) grid[i] = key[k]; uses[i]++; });
        paths[w] = p;
        if (place(depth + 1)) return true;
        p.forEach(function (i) { uses[i]--; if (!uses[i]) grid[i] = ""; });
        if (budget <= 0) break;
      }
      stuck[key] = (stuck[key] || 0) + 1;
      return false;
    }
    return place(0) ? { grid: grid, paths: paths } : null;
  }

  // Filler: mostly letters from the puzzle's own words so the answers don't stand out, the rest by language
  // frequency. Q, X and Z only if a word uses them. Rerolled if it spells a blocked word through a filler tile.
  function fillBoard(base, paths, keys, lang, cols, rows, seed) {
    var inWords = keys.join(""), pool = [];
    for (var c = 0; c < inWords.length; c++) pool.push(inWords[c]);
    var freq = [];
    Object.keys(FREQ[lang]).forEach(function (l) { if (RARE.indexOf(l) < 0 || inWords.indexOf(l) >= 0) freq.push([l, FREQ[lang][l]]); });
    var total = freq.reduce(function (s, x) { return s + x[1]; }, 0);
    var empty = []; base.forEach(function (l, i) { if (!l) empty.push(i); });
    var words = BLOCK[lang].concat(lang === "es" ? BLOCK.en : []).filter(function (w) { return w.length >= 4; });
    for (var roll = 0; roll < 60; roll++) {
      var r = rng(seed + ":fill:" + roll), grid = base.slice();
      empty.forEach(function (i) {
        if (r() < 0.6) grid[i] = pool[Math.floor(r() * pool.length)];
        else { var x = r() * total; for (var k = 0; k < freq.length; k++) { x -= freq[k][1]; if (x < 0) { grid[i] = freq[k][0]; break; } } if (!grid[i]) grid[i] = freq[0][0]; }
      });
      var hit = blockedOnBoard(grid, words, cols, rows, empty);
      if (!hit) return { grid: grid, filler: empty };
    }
    return null;
  }

  // a blocked word spelled anywhere on the board along a path that uses at least one filler tile
  function blockedOnBoard(grid, words, cols, rows, filler) {
    var isFiller = {}; (filler || []).forEach(function (i) { isFiller[i] = true; });
    var pre = {}; words.forEach(function (w) { for (var i = 1; i <= w.length; i++) pre[w.slice(0, i)] = true; });
    var set = {}; words.forEach(function (w) { set[w] = true; });
    var hit = null, used = {};
    function go(i, s, viaFiller) {
      if (hit) return;
      s += grid[i];
      if (!pre[s]) return;
      viaFiller = viaFiller || !!isFiller[i];
      if (set[s] && (viaFiller || !filler)) { hit = s; return; }
      used[i] = true;
      var n = neighbours(i, cols, rows);
      for (var j = 0; j < n.length; j++) if (!used[n[j]]) go(n[j], s, viaFiller);
      used[i] = false;
    }
    for (var i = 0; i < grid.length && !hit; i++) go(i, "", false);
    return hit;
  }

  var api = { LIMITS: LIMITS, DIFFICULTIES: DIFFICULTIES, normalizeWord: normalizeWord, validatePuzzle: validatePuzzle, blocked: blocked,
    generateBoard: generateBoard, findPath: findPath, spellPath: spellPath, adjacent: adjacent, neighbours: neighbours,
    blockedOnBoard: blockedOnBoard, rng: rng, LAUNCH: LAUNCH, numberOf: numberOf, dayOf: dayOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LLX_WF = api;
})(typeof window !== "undefined" ? window : this);
