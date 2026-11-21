// Tests for Linx WordFinder's puzzle rules and board generator.  Run: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs"), path = require("path"), vm = require("vm");
const W = require("../wordfinder.js");
const BLOCK = require("../wordfinder-blocklist.js");

const COLS = 6, ROWS = 10;
const sample = (words, extra) => ({ topic: "Countries", difficulty: "easy", words: words.map((w) => ({ word: w, hint: "A country in the world" })), ...extra });
const EN_COUNTRIES = ["ARGENTINA", "PERU", "GERMANY", "LUXEMBOURG", "FRANCE", "CHINA"];
const ES_COUNTRIES = ["ARGENTINA", "PERÚ", "ALEMANIA", "LUXEMBURGO", "FRANCIA", "CHINA"];

// random puzzles from the game's own dictionaries, reproducible from a seed
function dictionary(file, global) {
  const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), ctx);
  return ctx.window[global].split("|").map((w) => w.toUpperCase()).filter((w) => w.length >= 3 && w.length <= 10 && !W.blocked(w, "es"));
}
const DICT = { en: dictionary("words.js", "LLX_WORDS"), es: dictionary("words-es.js", "LLX_WORDS_ES") };
function randomPuzzle(lang, n) {
  const r = W.rng("puzzle-" + lang + "-" + n), out = [];
  let total = 0;
  while (out.length < 6) {
    const w = DICT[lang][Math.floor(r() * DICT[lang].length)];
    const left = 6 - out.length - 1;
    if (out.includes(w) || total + w.length + left * 3 > 45) continue;
    if (out.some((o) => o.includes(w) || w.includes(o))) continue;
    out.push(w); total += w.length;
  }
  return out;
}

// a board's every claim, checked from first principles
function checkBoard(b, words, lang) {
  assert.equal(b.grid.length, COLS * ROWS, "board has 60 tiles");
  b.grid.forEach((l, i) => assert.match(l, /^[A-ZÑ]$/, `tile ${i} holds one letter`));
  words.forEach((w, k) => {
    const key = W.normalizeWord(w).key, p = b.paths[k];
    assert.equal(p.length, key.length, `${key}: one tile per letter`);
    assert.equal(new Set(p).size, p.length, `${key}: no tile used twice`);
    for (let i = 1; i < p.length; i++) assert.ok(W.adjacent(p[i - 1], p[i], COLS), `${key}: tiles ${p[i - 1]} and ${p[i]} touch`);
    assert.equal(W.spellPath(b.grid, p, COLS), key, `${key}: its path spells it`);
    assert.ok(W.findPath(b.grid, w, COLS, ROWS), `${key}: findable on the board`);
  });
  const covered = new Set(b.paths.flat());
  assert.deepEqual([...b.filler].sort((x, y) => x - y), [...Array(60).keys()].filter((i) => !covered.has(i)), "filler is exactly the tiles no word uses");
  const inWords = words.map((w) => W.normalizeWord(w).key).join("");
  for (const rare of ["Q", "X", "Z"]) if (!inWords.includes(rare)) b.filler.forEach((i) => assert.notEqual(b.grid[i], rare, `no ${rare} unless a word uses it`));
  const blockWords = BLOCK[lang].concat(lang === "es" ? BLOCK.en : []).filter((w) => w.length >= 4);
  assert.equal(W.blockedOnBoard(b.grid, blockWords, COLS, ROWS, b.filler), null, "filler spells no blocked word");
}

/* ---------- word rules ---------- */

test("normalizeWord uppercases, strips accents for matching, keeps Ñ", () => {
  assert.deepEqual(W.normalizeWord("Perú"), { display: "PERÚ", key: "PERU" });
  assert.deepEqual(W.normalizeWord("ñandú"), { display: "ÑANDÚ", key: "ÑANDU" });
  assert.deepEqual(W.normalizeWord(" canción "), { display: "CANCIÓN", key: "CANCION" });
  assert.equal(W.normalizeWord("PINGÜINO").key, "PINGUINO");
});

test("the Countries example passes in both languages", () => {
  const en = W.validatePuzzle(sample(EN_COUNTRIES), "en"), es = W.validatePuzzle(sample(ES_COUNTRIES, { topic: "Países" }), "es");
  assert.ok(en.ok, JSON.stringify(en.errors)); assert.ok(es.ok, JSON.stringify(es.errors));
  assert.equal(en.totalLetters, 41); assert.equal(es.totalLetters, 43);
  assert.equal(es.words[1].display, "PERÚ", "the accented spelling is kept for display");
});

test("rejects words that break the rules, with a clear message", () => {
  const cases = [
    ["NEW ZEALAND", /space/], ["COCA-COLA", /aren't letters/], ["R2D2", /aren't letters/], ["OX", /3–10/],
    ["CONSTANTINOPLE", /3–10/],
  ];
  for (const [bad, msg] of cases) {
    const v = W.validatePuzzle(sample([bad, "PERU", "CHILE", "CUBA", "OMAN", "IRAN"]), "en");
    assert.ok(!v.ok, bad + " should fail");
    assert.ok(v.errors.some((e) => msg.test(e.message) && e.field === "words.0"), bad + ": " + JSON.stringify(v.errors));
  }
});

test("caps the total at 45 letters, needs exactly 6 words, and catches duplicates", () => {
  const long = W.validatePuzzle(sample(["AFGHANISTAN".slice(0, 10), "LUXEMBOURG", "MOZAMBIQUE", "MAURITANIA", "INDONESIA", "PERU"]), "en");
  assert.ok(long.errors.some((e) => /limit is 45/.test(e.message)));
  assert.ok(W.validatePuzzle(sample(["PERU", "CHILE"]), "en").errors.some((e) => /exactly 6/.test(e.message)));
  const dup = W.validatePuzzle(sample(["PERU", "PERÚ", "CHILE", "CUBA", "OMAN", "IRAN"]), "es");
  assert.ok(dup.errors.some((e) => /twice/.test(e.message)), "PERU and PERÚ count as the same word");
});

test("warns (doesn't block) when one word is inside another", () => {
  const v = W.validatePuzzle(sample(["CAT", "CATALOG", "DOG", "FISH", "BIRD", "MOUSE"]), "en");
  assert.ok(v.ok);
  assert.ok(v.warnings.some((w) => /CAT is inside CATALOG/.test(w.message)));
});

test("checks hints: present, short, not giving the word away", () => {
  const base = EN_COUNTRIES.map((w) => ({ word: w, hint: "A country" }));
  const withHint = (h) => W.validatePuzzle({ topic: "Countries", words: base.map((x, i) => (i === 3 ? { ...x, hint: h } : x)) }, "en");
  assert.ok(withHint("").errors.some((e) => e.field === "hints.3" && /empty/.test(e.message)));
  assert.ok(withHint("x".repeat(81)).errors.some((e) => /longer than 80/.test(e.message)));
  assert.ok(withHint("Luxembourg is tiny").errors.some((e) => /gives away/.test(e.message)));
  const w = withHint("Starts with L, small and rich");
  assert.ok(w.ok && w.warnings.some((x) => /mentions letters/.test(x.message)));
});

test("blocks profanity in words, hints and topic, in both languages", () => {
  const plant = BLOCK.en[0], plantEs = BLOCK.es[0];
  assert.ok(!W.validatePuzzle(sample([plant, "PERU", "CHILE", "CUBA", "OMAN", "IRAN"]), "en").ok);
  const hint = W.validatePuzzle({ topic: "Countries", words: EN_COUNTRIES.map((w, i) => ({ word: w, hint: i ? "A country" : "Not a " + plant.toLowerCase() })) }, "en");
  assert.ok(hint.errors.some((e) => /blocked/.test(e.message) && e.field === "hints.0"));
  assert.ok(!W.validatePuzzle(sample(ES_COUNTRIES, { topic: "Países " + plantEs }), "es").ok);
  assert.ok(W.validatePuzzle(sample(EN_COUNTRIES, { topic: "Countries and Capitals" }), "en").ok, "ordinary words aren't flagged");
});

test("Ñ is allowed in Spanish and refused in English", () => {
  const es = ["ESPAÑA", "ÑANDÚ", "MONTAÑA", "PIÑA", "NIÑO", "AÑO"];
  assert.ok(W.validatePuzzle(sample(es, { topic: "Con eñe" }), "es").ok);
  assert.ok(W.validatePuzzle(sample(es), "en").errors.some((e) => /only allowed in Spanish/.test(e.message)));
});

test("difficulty must be easy, medium or hard", () => {
  assert.ok(!W.validatePuzzle(sample(EN_COUNTRIES, { difficulty: "extreme" }), "en").ok);
  for (const d of W.DIFFICULTIES) assert.ok(W.validatePuzzle(sample(EN_COUNTRIES, { difficulty: d }), "en").ok);
});

/* ---------- board ---------- */

test("the Countries boards hold every word as a connected path, in both languages", () => {
  for (const [lang, words] of [["en", EN_COUNTRIES], ["es", ES_COUNTRIES]]) {
    const b = W.generateBoard(words, lang, "2026-12-01");
    assert.ok(b.ok, b.error); checkBoard(b, words, lang);
  }
});

test("the same seed gives the same board; a different seed a different one", () => {
  const a = W.generateBoard(EN_COUNTRIES, "en", "seed-1"), b = W.generateBoard(EN_COUNTRIES, "en", "seed-1"), c = W.generateBoard(EN_COUNTRIES, "en", "seed-2");
  assert.deepEqual(a.grid, b.grid); assert.deepEqual(a.paths, b.paths); assert.equal(a.seed, b.seed);
  assert.notDeepEqual(a.grid, c.grid);
  assert.deepEqual(W.generateBoard(EN_COUNTRIES, "en", a.seed).grid, a.grid, "storing the seed it reports rebuilds the board");
});

test("tiles are shared between words when it helps, and when space demands it", () => {
  // 11 letters on 8 tiles only fits if FRANCE and CHINA share
  const tight = W.generateBoard(["FRANCE", "CHINA"], "en", "tight", { cols: 4, rows: 2 });
  assert.ok(tight.ok, tight.error); assert.ok(tight.shared >= 3);
  ["FRANCE", "CHINA"].forEach((w, k) => assert.equal(W.spellPath(tight.grid, tight.paths[k], 4), w));
  const shares = [];
  for (let n = 0; n < 40; n++) { const b = W.generateBoard(randomPuzzle("en", n), "en", "share-" + n); shares.push(b.shared); }
  assert.ok(shares.filter((s) => s > 0).length >= 30, "most random boards share at least one tile: " + shares.join(","));
});

for (const lang of ["en", "es"]) {
  test(`50 random ${lang === "en" ? "English" : "Spanish"} puzzles all generate valid boards`, () => {
    let ms = 0, fromWords = 0, fillerTiles = 0;
    for (let n = 0; n < 50; n++) {
      const words = randomPuzzle(lang, n);
      const t = Date.now(), b = W.generateBoard(words, lang, lang + "-" + n); ms += Date.now() - t;
      assert.ok(b.ok, `${words.join(", ")}: ${b.error}`);
      checkBoard(b, words, lang);
      const letters = words.join("");
      b.filler.forEach((i) => { fillerTiles++; if (letters.includes(b.grid[i])) fromWords++; });
    }
    assert.ok(fromWords / fillerTiles > 0.6, `filler mostly uses the puzzle's own letters (${Math.round(100 * fromWords / fillerTiles)}%)`);
    assert.ok(ms / 50 < 1000, `average ${Math.round(ms / 50)} ms per board`);
  });
}

test("Spanish boards keep Ñ and match accented words", () => {
  const words = ["ESPAÑA", "ÑANDÚ", "MONTAÑA", "PIÑA", "NIÑO", "CANCIÓN"];
  const b = W.generateBoard(words, "es", "ñ");
  assert.ok(b.ok, b.error); checkBoard(b, words, "es");
  assert.ok(b.grid.includes("Ñ"));
  assert.ok(W.findPath(b.grid, "cancion", COLS, ROWS) && W.findPath(b.grid, "CANCIÓN", COLS, ROWS), "found with or without the accent");
  assert.ok(!b.grid.some((l) => /[ÁÉÍÓÚÜ]/.test(l)), "tiles never show accents");
});

test("spellPath accepts only legal drags", () => {
  const b = W.generateBoard(EN_COUNTRIES, "en", "drag");
  const p = b.paths[0];
  assert.equal(W.spellPath(b.grid, p, COLS), "ARGENTINA");
  assert.equal(W.spellPath(b.grid, [p[0], p[0]], COLS), null, "same tile twice");
  assert.equal(W.spellPath(b.grid, [0, 59], COLS), null, "tiles that don't touch");
  assert.equal(W.spellPath(b.grid, [0, 60], COLS), null, "off the board");
  assert.equal(W.spellPath(b.grid, [], COLS), null);
});

test("a blocked word planted through filler is caught", () => {
  const grid = Array(60).fill("A"), word = BLOCK.en.find((w) => w.length === 4);
  [0, 1, 2, 3].forEach((i, k) => { grid[i] = word[k]; });
  assert.equal(W.blockedOnBoard(grid, [word], COLS, ROWS, [2]), word);
  assert.equal(W.blockedOnBoard(grid, [word], COLS, ROWS, [40]), null, "ignored when no filler tile is involved");
});

test("failures explain which word is the problem", () => {
  const tooBig = W.generateBoard(["LUXEMBOURG", "PERU"], "en", "x", { cols: 3, rows: 3 });
  assert.ok(!tooBig.ok); assert.equal(tooBig.word, "LUXEMBOURG"); assert.match(tooBig.error, /LUXEMBOURG/);
  const crowded = W.generateBoard(["ABCDEFGHI", "JKLMNOPQR", "STUVWXYZA"], "en", "x", { cols: 4, rows: 4, tries: 5 });
  assert.ok(!crowded.ok); assert.ok(crowded.word, "names a word"); assert.match(crowded.error, /No board found after 5 tries/);
  const junk = W.generateBoard(["NEW ZEALAND", "PERU"], "en", "x");
  assert.ok(!junk.ok); assert.match(junk.error, /NEW ZEALAND/);
});
