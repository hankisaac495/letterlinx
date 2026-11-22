// Puzzle writing with Claude, tested against a local stand-in for the Claude API (no key or network needed).
// It checks the requests we send (model, structured output, refusal fallback) and how answers are checked.
const test = require("node:test"), assert = require("node:assert"), http = require("http");
const SAMPLES = require("../api/_wf_samples.js");

let requests = [], reply = null;
const server = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    requests.push({ url: req.url, headers: req.headers, body });
    const r = reply(body);
    res.setHeader("content-type", "application/json");
    if (r.status) { res.statusCode = r.status; return res.end(JSON.stringify({ type: "error", error: { type: r.etype || "error", message: r.emsg || "x" } })); }
    res.end(JSON.stringify({ id: "msg_test", type: "message", role: "assistant", model: body.model, stop_reason: r.stop || "end_turn",
      content: [{ type: "text", text: typeof r.json === "string" ? r.json : JSON.stringify(r.json) }], usage: { input_tokens: 900, output_tokens: 700 } }));
  });
});

let AI;
test.before(async () => {
  await new Promise((ok) => server.listen(0, ok));
  process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:" + server.address().port;
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  AI = require("../api/_wf_ai.js");
});
test.after(() => server.close());
test.beforeEach(() => { requests = []; });

const sample = (n, lang) => ({ topic: SAMPLES[n][lang].topic, words: SAMPLES[n][lang].words });

test("planning a month asks once, with every day and recent topics, and returns a topic per day", async () => {
  reply = (b) => ({ json: { days: [...b.messages[0].content.matchAll(/^(\d{4}-\d{2}-\d{2})/gm)].map((m, i) => ({ day: m[1], en_topic: "Topic " + i, es_topic: "Tema " + i })) } });
  const days = ["2026-12-01", "2026-12-02", "2026-12-05"];
  const r = await AI.planMonth(days, ["Countries", "Fruit"]);
  assert.strictEqual(requests.length, 1);
  const q = requests[0];
  assert.match(q.url, /^\/v1\/messages/);
  assert.strictEqual(q.body.model, "claude-opus-5-5");
  assert.strictEqual(q.body.fallbacks, "default");
  assert.match(q.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
  assert.strictEqual(q.body.output_config.format.type, "json_schema");
  assert.ok(!("thinking" in q.body), "thinking is left to the model's default");
  assert.match(q.body.system, /Family-friendly/);
  assert.match(q.body.messages[0].content, /Countries; Fruit/);
  assert.deepStrictEqual(r.topics.map((x) => x.day), days);
  assert.strictEqual(r.topics[0].en, "Topic 0"); assert.strictEqual(r.topics[2].es, "Tema 2");
  assert.strictEqual(r.topics[2].difficulty, "hard");            // a Saturday
});

test("a day's words are checked against the rules and get a board in both languages", async () => {
  reply = () => ({ json: { en: sample(0, "en"), es: sample(1, "es") } });
  const r = await AI.writeDay({ day: "2026-12-01", en: "Countries", es: "Frutas", difficulty: "easy" });
  assert.ok(r.en.ok && r.es.ok);
  assert.strictEqual(r.en.board.grid.length, 60); assert.strictEqual(r.es.board.grid.length, 60);
  assert.strictEqual(r.es.puzzle.words[0].word, "PLÁTANO");
});

test("rule problems are reported, and a second attempt lists them for Claude", async () => {
  const bad = { topic: "Desserts", words: [{ word: "ICE CREAM", hint: "Cold and sweet." }, ...sample(1, "en").words.slice(1)] };
  reply = () => ({ json: { en: bad, es: sample(1, "es") } });
  const r = await AI.writeDay({ day: "2026-12-01", en: "Desserts", es: "Postres" });
  assert.strictEqual(r.en.ok, false); assert.match(r.en.errors[0], /space/);
  assert.strictEqual(r.es.ok, true);
  await AI.writeDay({ day: "2026-12-01", en: "Desserts", es: "Postres", fix: r.en.errors });
  assert.match(requests[1].body.messages[0].content, /earlier attempt had these problems[\s\S]*space/);
});

test("one word or one hint can be replaced", async () => {
  reply = () => ({ json: { word: "kiwi", hint: "Fuzzy brown skin, green inside." } });
  const words = sample(1, "en").words;
  const w = await AI.rewriteItem({ lang: "en", topic: "Fruit", words, index: 2, part: "word" });
  assert.strictEqual(w.word, "KIWI");
  assert.match(requests[0].body.messages[0].content, /BANANA, MANGO, LEMON/);
  const h = await AI.rewriteItem({ lang: "en", topic: "Fruit", words, index: 2, part: "hint" });
  assert.strictEqual(h.word, "CHERRY");                              // a new hint keeps the word
});

test("refusals, cut-off answers, unreadable answers and API errors become plain messages", async () => {
  for (const [r, code] of [[{ stop: "refusal", json: "" }, "refused"], [{ stop: "max_tokens", json: "{" }, "too_long"], [{ json: "not json" }, "bad_output"], [{ status: 401 }, "bad_key"], [{ status: 400 }, "api"], [{ status: 429 }, "busy"], [{ status: 529 }, "busy"]]) {
    reply = () => r;
    await assert.rejects(AI.planMonth(["2026-12-01"], []), (e) => e instanceof AI.AiError && e.code === code && e.message.length > 10);
  }
});

test("without a key, generation is off and says how to turn it on", async () => {
  const key = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try {
    assert.strictEqual(AI.enabled(), false);
    await assert.rejects(AI.planMonth(["2026-12-01"], []), (e) => e.code === "no_key" && /ANTHROPIC_API_KEY/.test(e.message));
    assert.strictEqual(requests.length, 0);
  } finally { process.env.ANTHROPIC_API_KEY = key; }
});

test("error messages include Anthropic's own reason", async () => {
  reply = () => ({ status: 401, etype: "authentication_error", emsg: "invalid x-api-key" });
  await assert.rejects(AI.planMonth(["2026-12-01"], []), (e) => e.code === "bad_key" && /invalid x-api-key/.test(e.message) && /sk-ant-/.test(e.message));
  reply = () => ({ status: 400, etype: "invalid_request_error", emsg: "Your credit balance is too low to access the Anthropic API." });
  await assert.rejects(AI.planMonth(["2026-12-01"], []), (e) => e.code === "no_credit" && /Billing/.test(e.message));
  reply = () => ({ status: 404, etype: "not_found_error", emsg: "model: claude-opus-5-5" });
  await assert.rejects(AI.planMonth(["2026-12-01"], []), (e) => e.code === "model");
});

test("an account that rejects the fallback option is asked again without it", async () => {
  reply = (b) => b.fallbacks ? { status: 400, etype: "invalid_request_error", emsg: "fallbacks: unexpected parameter for this beta" }
    : { json: { days: [{ day: "2026-12-01", en_topic: "Birds", es_topic: "Aves" }] } };
  const r = await AI.planMonth(["2026-12-01"], []);
  assert.strictEqual(r.topics[0].en, "Birds");
  assert.strictEqual(requests.length, 2);
  assert.ok(!("fallbacks" in requests[1].body) && !/fallback/.test(requests[1].headers["anthropic-beta"] || ""));
});

test("a key without permission for the fallback option still works without it", async () => {
  reply = (b) => b.fallbacks ? { status: 403, etype: "permission_error", emsg: "Your organization does not have access to this feature." }
    : { json: { days: [{ day: "2026-12-01", en_topic: "Trees", es_topic: "Árboles" }] } };
  const r = await AI.planMonth(["2026-12-01"], []);
  assert.strictEqual(r.topics[0].en, "Trees");
  reply = () => ({ status: 403, etype: "permission_error", emsg: "This key can't use this workspace." });   // refused both ways: say so
  await assert.rejects(AI.planMonth(["2026-12-01"], []), (e) => e.code === "forbidden" && /can't use this workspace/.test(e.message));
});
