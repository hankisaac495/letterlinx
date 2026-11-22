// Linx WordFinder puzzle writing with Claude. Server only: the API key (ANTHROPIC_API_KEY) never reaches a browser.
// Each request is small enough to finish well inside Vercel's 60-second limit:
//   planMonth  -> one topic per day (English and Spanish), avoiding recent topics
//   writeDay   -> six words and hints for one day in both languages
//   rewriteItem -> a new word (with hint) or just a new hint for one slot
// Every result is checked against the puzzle rules and must produce a board before it is used.
const W = require("../wordfinder.js");

const MODEL = process.env.WF_AI_MODEL || "claude-opus-5-5";
const enabled = () => !!process.env.ANTHROPIC_API_KEY;

class AiError extends Error { constructor(code, message) { super(message); this.code = code; } }

let client = null;
function getClient() {
  if (!enabled()) throw new AiError("no_key", "Puzzle generation is switched off: add ANTHROPIC_API_KEY in Vercel (Settings → Environment Variables) and redeploy.");
  if (!client) {
    const sdk = require("@anthropic-ai/sdk"), Anthropic = sdk.default || sdk;
    client = new Anthropic({ timeout: 55000, maxRetries: 1 });   // reads ANTHROPIC_API_KEY from the environment
  }
  return client;
}

// The content guidelines Claude follows for every puzzle.
const GUIDE = `You write puzzles for Linx WordFinder, a free daily word-search game played in English and Spanish by all ages, including schoolchildren and families.

Each day has one topic. Six words on that topic are hidden in a 6 × 10 letter board; players find them by dragging through neighbouring letters and can ask for a hint (a short clue) for any word.

Rules every puzzle must meet (they are checked by code, and a puzzle that breaks one is rejected):
- Exactly 6 words, each a single word of ${W.LIMITS.minLen}–${W.LIMITS.maxLen} letters: letters only, no spaces, hyphens, digits or apostrophes.
- The six words together have at most ${W.LIMITS.maxTotal} letters. Aim for 25–40.
- No word appears twice, and no word contains another (not CAT with CATFISH).
- The topic is at most ${W.LIMITS.maxTopic} characters. Each hint is at most ${W.LIMITS.maxHint} characters.
- English words and hints use American spelling.
- Spanish words use standard Spanish spelling with accents and Ñ where they belong (PLÁTANO, ARAÑA). English words never contain Ñ.

Content guidelines:
- Family-friendly and welcoming worldwide. Avoid violence, weapons, drugs, alcohol, crime, disease, death, politics, religion, current events, brands and trademarks, and real living people.
- Topics are broad and familiar: animals, food, nature, places, science, music, sports, the home, jobs, transport, hobbies, colours, weather, space and similar. Give a topic a fresh angle rather than repeating it (for example "Things at the beach" rather than "Beach" again).
- Words are common nouns (or well-known names such as countries and planets) that most players would know. On easy days, everyday words; on hard days, less obvious but still fair members of the topic.
- Hints describe the word without using it, a word from the same family, or its spelling: never mention letters, the first letter, or the length. Each hint is one short, friendly sentence that ends with a full stop.
- The Spanish puzzle is on the same topic but written as natural Spanish for Spanish speakers, not a word-for-word translation: choose words and hints that are natural in Spanish, even where they differ from the English ones. Use neutral Spanish understood in Spain and Latin America; avoid words whose meaning changes between countries.`;

const PUZZLE = {
  type: "object", additionalProperties: false, required: ["topic", "words"],
  properties: {
    topic: { type: "string" },
    words: { type: "array", items: { type: "object", additionalProperties: false, required: ["word", "hint"], properties: { word: { type: "string" }, hint: { type: "string" } } } },
  },
};

async function ask(prompt, schema, maxTokens) {
  const c = getClient();
  let r;
  try {
    r = await c.beta.messages.create({
      model: MODEL,
      max_tokens: maxTokens || 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",                                   // a declined request is retried on Anthropic's recommended fallback model
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      system: GUIDE,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    const status = e && e.status;
    if (status === 401 || status === 403) throw new AiError("bad_key", "The Anthropic API key was refused. Check ANTHROPIC_API_KEY in Vercel.");
    if (status === 429) throw new AiError("busy", "Claude is busy or the account's spend limit was reached. Try again in a minute, or check console.anthropic.com.");
    if (e && (e.name === "APIConnectionTimeoutError" || /timed? ?out/i.test(e.message || ""))) throw new AiError("timeout", "Claude took too long to answer. Try again.");
    throw new AiError("api", "Claude couldn't be reached (" + (status || (e && e.message) || "error") + "). Try again.");
  }
  if (r.stop_reason === "refusal") throw new AiError("refused", "Claude declined to write this one. Try a different topic.");
  if (r.stop_reason === "max_tokens") throw new AiError("too_long", "Claude's answer was cut off. Try again.");
  const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  try { return { data: JSON.parse(text), usage: r.usage, model: r.model }; }
  catch (e) { throw new AiError("bad_output", "Claude's answer couldn't be read. Try again."); }
}

const DIFF = { 0: "hard", 1: "easy", 2: "easy", 3: "medium", 4: "medium", 5: "medium", 6: "hard" };   // by weekday: gentler early in the week
const weekday = (d) => new Date(d + "T12:00:00Z").getUTCDay();
const weekdayName = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

/* one topic per day, for the days given; `avoid` lists recent and upcoming topics */
async function planMonth(days, avoid) {
  const schema = { type: "object", additionalProperties: false, required: ["days"], properties: { days: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["day", "en_topic", "es_topic"],
    properties: { day: { type: "string" }, en_topic: { type: "string" }, es_topic: { type: "string" } } } } } };
  const list = days.map((d) => `${d} (${weekdayName(d)}, ${DIFF[weekday(d)]})`).join("\n");
  const prompt = `Plan one topic for each of these days. Each line gives the date, weekday and difficulty.

${list}

Topics already used recently or planned (don't repeat these or near-duplicates of them):
${avoid.length ? avoid.slice(0, 300).join("; ") : "(none yet)"}

Vary the topics across the month: mix themes, and don't put similar topics on neighbouring days. Match the difficulty: easy days get very familiar topics, hard days can be more specialised but must still suit a general audience. For each day give the English topic and the Spanish topic (the same theme, phrased naturally in Spanish). Return every day listed, using its date as written.`;
  const { data, usage } = await ask(prompt, schema, 8000);
  const byDay = {};
  for (const x of Array.isArray(data.days) ? data.days : []) if (days.includes(x.day)) byDay[x.day] = { en: String(x.en_topic || "").trim().slice(0, W.LIMITS.maxTopic), es: String(x.es_topic || "").trim().slice(0, W.LIMITS.maxTopic) };
  return { topics: days.map((d) => ({ day: d, difficulty: DIFF[weekday(d)], en: byDay[d] ? byDay[d].en : "", es: byDay[d] ? byDay[d].es : "" })), usage };
}

/* checks a language's result and builds its board; problems are listed in plain words */
function check(p, lang, seed) {
  const v = W.validatePuzzle(p, lang);
  if (!v.ok) return { ok: false, errors: v.errors.map((e) => e.message), warnings: v.warnings.map((w) => w.message) };
  const board = W.generateBoard(p.words, lang, seed);
  if (!board.ok) return { ok: false, errors: [board.error], warnings: v.warnings.map((w) => w.message) };
  return { ok: true, board, errors: [], warnings: v.warnings.map((w) => w.message) };
}

/* six words and hints for one day, in both languages; `fix` lists problems from an earlier attempt */
async function writeDay({ day, en, es, difficulty, fix }) {
  const lang = (l) => ({ type: "object", additionalProperties: false, required: ["topic", "words"], properties: PUZZLE.properties });
  const schema = { type: "object", additionalProperties: false, required: ["en", "es"], properties: { en: lang("en"), es: lang("es") } };
  const prompt = `Write the puzzle${day ? " for " + weekdayName(day) + " " + day : ""}. Difficulty: ${difficulty || "medium"}.
English topic: ${en || "(choose a good topic)"}
Spanish topic: ${es || (en ? "(the same theme in natural Spanish)" : "(the same theme as the English one, in natural Spanish)")}

Give 6 words with a hint each in English, and 6 words with a hint each in Spanish. Keep the topics as given unless one is empty.${fix ? `

An earlier attempt had these problems; avoid them this time:
${fix.map((x) => "- " + x).join("\n")}` : ""}`;
  const { data, usage } = await ask(prompt, schema, 8000);
  const out = {};
  for (const l of ["en", "es"]) {
    const p = data && data[l] ? data[l] : { topic: "", words: [] };
    const puzzle = { topic: String(p.topic || "").trim(), difficulty: W.DIFFICULTIES.includes(difficulty) ? difficulty : "medium",
      words: (Array.isArray(p.words) ? p.words : []).slice(0, 8).map((w) => ({ word: String((w && w.word) || "").trim().toUpperCase(), hint: String((w && w.hint) || "").trim() })) };
    const seed = Math.random().toString(36).slice(2, 10);
    out[l] = { puzzle, seed, ...check(puzzle, l, seed) };
  }
  return { ...out, usage };
}

/* a replacement for one slot: a new word and hint ("word"), or a new hint for the same word ("hint") */
async function rewriteItem({ lang, topic, words, index, part }) {
  const schema = { type: "object", additionalProperties: false, required: ["word", "hint"], properties: { word: { type: "string" }, hint: { type: "string" } } };
  const others = words.filter((w, i) => i !== index && w.word).map((w) => w.word);
  const cur = words[index] || { word: "", hint: "" };
  const L = lang === "es" ? "Spanish" : "English";
  const used = words.reduce((n, w, i) => n + (i === index ? 0 : W.normalizeWord(w.word).key.length), 0);
  const prompt = part === "hint"
    ? `${L} puzzle, topic "${topic}". Write a new, different hint for the word ${cur.word}${cur.hint ? ` (the current hint is "${cur.hint}")` : ""}. Return the same word and the new hint.`
    : `${L} puzzle, topic "${topic}". The other words are: ${others.join(", ") || "(none yet)"}.
Suggest one more word on the topic to replace ${cur.word || "the empty slot"}, with a hint. It must not be one of the other words, contain one of them, or be contained in one. It can have at most ${Math.max(W.LIMITS.minLen, Math.min(W.LIMITS.maxLen, W.LIMITS.maxTotal - used))} letters so the puzzle stays within ${W.LIMITS.maxTotal} letters in total.`;
  const { data, usage } = await ask(prompt, schema, 3000);
  const word = part === "hint" ? cur.word : String(data.word || "").trim().toUpperCase();
  return { word, hint: String(data.hint || "").trim(), usage };
}

module.exports = { enabled, planMonth, writeDay, rewriteItem, check, AiError, MODEL, GUIDE };
