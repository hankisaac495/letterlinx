// Linx WordFinder end-to-end tests: a real browser against the local server, with a stand-in for the Claude API.
//   E2E_DATABASE_URL=postgres://user:pass@localhost:5432/empty_test_db  npm run e2e
// Needs an EMPTY Postgres database (the tests create puzzles for today) and Playwright with Chromium.
// Covers: generating and approving puzzles, playing a full day (by dragging and by typing), a hint, the leaderboard,
// sharing, Spanish, accessibility announcements, reduced motion, and that answers stay hidden until solved.
const test = require("node:test"), assert = require("node:assert"), http = require("http"), path = require("path"), { spawn } = require("child_process");
const { chromium } = require("playwright");
const W = require("../../wordfinder.js"), SAMPLES = require("../../api/_wf_samples.js");

const DB = process.env.E2E_DATABASE_URL;
const PORT = 3100 + Math.floor(Math.random() * 400), MOCK = PORT + 500, U = "http://localhost:" + PORT;
const ADMIN = { email: "admin@e2e.test", password: "e2e-password-1", screenName: "E2EAdmin" };
const today = new Date().toISOString().slice(0, 10);       // the server and this machine both count in UTC here

/* stand-in for the Claude API: topics cycle through the samples, so the answers are known */
let planned = [];
const mock = http.createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const b = JSON.parse(raw || "{}"), prompt = b.messages[0].content, props = b.output_config.format.schema.properties;
    let json;
    if (props.days) {
      planned = [...prompt.matchAll(/^(\d{4}-\d{2}-\d{2})/gm)].map((m) => m[1]);
      json = { days: planned.map((d, i) => ({ day: d, en_topic: SAMPLES[i % 4].en.topic, es_topic: SAMPLES[i % 4].es.topic })) };
    } else if (props.en) {
      const s = SAMPLES[Math.max(0, planned.indexOf((/(\d{4}-\d{2}-\d{2})/.exec(prompt) || [])[1])) % 4];
      json = { en: s.en, es: s.es };
    } else json = { word: "KIWI", hint: "A test suggestion." };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ id: "msg_e2e", type: "message", role: "assistant", model: b.model, stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(json) }], usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
const answers = (lang) => SAMPLES[0][lang].words.map((w) => W.normalizeWord(w.word).key);   // today is the first planned day

let server, browser;
test.before(async () => {
  if (!DB) throw new Error("Set E2E_DATABASE_URL to an empty test database.");
  await new Promise((ok) => mock.listen(MOCK, ok));
  server = spawn(process.execPath, [path.join(__dirname, "../../dev-server.js")], { env: { ...process.env, PORT: String(PORT), DATABASE_URL: DB,
    ADMIN_EMAILS: ADMIN.email, ANTHROPIC_API_KEY: "sk-ant-e2e", ANTHROPIC_BASE_URL: "http://127.0.0.1:" + MOCK, RESEND_API_KEY: "" }, stdio: "inherit" });
  for (let i = 0; i < 50; i++) { try { await fetch(U + "/"); break; } catch (e) { await new Promise((ok) => setTimeout(ok, 200)); } }
  browser = await chromium.launch();
});
test.after(async () => { if (browser) await browser.close(); if (server) server.kill(); mock.close(); });

async function page(opts) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: false, permissions: ["clipboard-read", "clipboard-write"], ...(opts || {}) });
  const p = await ctx.newPage();
  p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.addInitScript(() => { if (!localStorage.getItem("letterlinx.v1")) localStorage.setItem("letterlinx.v1", JSON.stringify({ tourSeen: true })); });
  return p;
}
async function drag(p, tiles) {
  const pts = await p.evaluate((t) => t.map((i) => { const r = document.querySelectorAll("#board .tile")[i].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }), tiles);
  await p.mouse.move(...pts[0]); await p.mouse.down(); for (const q of pts.slice(1)) await p.mouse.move(...q, { steps: 3 }); await p.mouse.up();
}
const grid = (p) => p.evaluate(() => [...document.querySelectorAll("#board .tile")].map((t) => t.firstChild.textContent));
const until = async (p, fn, arg) => p.waitForFunction(fn, arg, { timeout: 15000 });

test("an admin writes the month with Claude and approves today's puzzle in both languages", async () => {
  const p = await page({ viewport: { width: 1280, height: 900 } });
  await p.goto(U + "/");
  const reg = await p.evaluate(async (a) => (await fetch("/api/auth", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "register", ...a }) })).status, ADMIN);
  assert.strictEqual(reg, 200);
  await p.goto(U + "/?admin#admin");
  await p.waitForSelector(".wfa-gen button:not([disabled])");
  await p.click('.wfa-gen button:has-text("with Claude")');
  await until(p, () => /^(Done|Stopped)/.test(document.querySelector(".wfa-gen strong")?.textContent || ""));
  assert.match(await p.textContent(".wfa-gen strong"), /^Done: \d+ ready to review, 0 need fixing, 0 failed/);
  const label = new Date(today + "T12:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  await p.click(`.wfa-day[aria-label="${label}"]`);
  for (const lang of ["en", "es"]) {
    await p.click(`.wfa-col[data-lang="${lang}"] .acts button:has-text("Approve")`);
    await until(p, (l) => /Approved/.test(document.querySelector(`.wfa-col[data-lang="${l}"] .wfa-colhead`).textContent), lang);
  }
  await p.click(".wfa-edhead button:has-text('Close')");
  await until(p, () => document.querySelectorAll(".wfa-day.today .pill.approved").length === 2);
  assert.deepStrictEqual(p.errors, []);
});

test("a guest plays today's puzzle: misses, a hint, all six words, the result, a nickname and the leaderboard", async () => {
  const p = await page();
  const seen = [];
  p.on("response", async (r) => { if (r.url().includes("/api/wordfinder")) seen.push(await r.text().catch(() => "")); });
  await p.goto(U + "/wordfinder");
  await until(p, () => document.getElementById("goTopic").textContent.length > 0);
  assert.strictEqual(await p.textContent("#goTopic"), SAMPLES[0].en.topic);
  assert.strictEqual((await grid(p)).join(""), "", "the board stays hidden until GO");
  await p.click("#go");
  await until(p, () => document.querySelector("#board .tile").firstChild.textContent !== "");
  const g = await grid(p), keys = answers("en");

  await drag(p, [0, 1, 2]);
  await until(p, () => /isn't one of the hidden words|^$/.test(document.getElementById("wfLive").textContent) && document.getElementById("wfLive").textContent !== "");
  await p.click("#wfHintBtn");
  await until(p, () => !document.getElementById("wfHints").hidden);
  assert.strictEqual(await p.evaluate(() => document.activeElement.closest("#wfHints") !== null), true, "focus moves into the hints dialog");
  await p.keyboard.press("Escape");
  assert.strictEqual(await p.evaluate(() => document.activeElement.id), "wfHintBtn", "Escape closes it and focus returns to the Hint button");
  // 10 seconds between hints: the button counts down, and the server refuses an early second hint
  assert.match(await p.textContent("#wfHintBtn"), /^Hint in \d+s$/);
  const early = await p.evaluate(async (d) => (await (await fetch("/api/wordfinder", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "hint", lang: "en", day: d }) })).json()), today);
  assert.ok(early.hintWait > 0 && early.play.hints.length === 1, "a second hint within 10 seconds is refused");

  await p.waitForTimeout(5200);                                // solves faster than 5 seconds aren't ranked
  for (const [i, k] of keys.entries()) {
    // before the last find, nothing the server has sent contains that word
    if (i === keys.length - 1) assert.ok(!seen.some((t) => t.includes('"' + SAMPLES[0].en.words[i].word.toUpperCase() + '"')), "unfound words never reach the browser");
    await drag(p, W.findPath(g, k, 6, 10));
    await until(p, (n) => document.querySelectorAll("#wfChips .wfchip").length === n || !document.getElementById("wfResults").hidden, i + 1);
  }
  await p.waitForSelector("#wfResults:not([hidden])");
  assert.match(await p.textContent("#wfDoneBreak"), /^\d+:\d\d \+ 0:30 hints = \d+:\d\d$/);
  assert.match(await p.textContent("#wfLive"), /Solved! Your time is/);
  assert.strictEqual(await p.$$eval("#wfDoneWords li", (n) => n.length), 6);

  await p.fill("#wfNick", "E2EAdmin");                         // a member's screen name
  await p.click("#wfNickSave");
  await until(p, () => /belongs to a LetterLinx member/.test(document.getElementById("wfNickMsg").textContent));
  await p.fill("#wfNick", "Speedy Guest"); await p.click("#wfNickSave");
  await until(p, () => /You're #1 of 1 today/.test(document.getElementById("wfRank").textContent));

  // share: topic and time, never the words
  await p.evaluate(() => { delete Navigator.prototype.share; });
  await p.click("#wfShareBtn");
  await until(p, () => document.getElementById("wfShareBtn").textContent === "Copied");
  const shared = await p.evaluate(() => navigator.clipboard.readText());
  assert.match(shared, new RegExp("^Linx WordFinder #" + W.numberOf(today) + " · " + SAMPLES[0].en.topic + "\\n⏱ \\d+:\\d\\d \\(1 hint\\)\\n" + U + "/wordfinder$"));
  assert.ok(!keys.some((k) => shared.toUpperCase().includes(k)));

  // the leaderboard tab
  await p.click('nav button[data-go="leaderboard"]');
  await until(p, () => document.querySelector('#lbTabs [data-v="wordfinder"]').getAttribute("aria-pressed") === "true" && document.querySelectorAll("#players tr").length > 0);
  assert.match(await p.textContent("#players"), /Speedy Guest \(you\)\d+:\d\d 1 hint/);
  assert.match(await p.textContent("#myStats .stats"), /1\s*Played/);

  // reloading shows the same result: one attempt per day
  await p.goto(U + "/wordfinder");
  await p.waitForSelector("#wfResults:not([hidden])");
  assert.deepStrictEqual(p.errors, []);
});

test("surrendering: the board blurs behind the dialog, Cancel carries on, End Game shows the answers", async () => {
  const p = await page();
  await p.goto(U + "/wordfinder");
  await until(p, () => document.getElementById("goTopic").textContent.length > 0);
  await p.click("#go");
  await until(p, () => document.querySelector("#board .tile").firstChild.textContent !== "");
  const g = await grid(p), keys = answers("en");
  await drag(p, W.findPath(g, keys[0], 6, 10));
  await until(p, () => document.querySelectorAll("#wfChips .wfchip").length === 1);
  await p.click("#wfStopBtn");
  await p.waitForSelector("#wfGiveUp:not([hidden])");
  assert.match(await p.textContent("#wfGiveUp"), /Surrender\?\s*End today's game and reveal the answers\. Try again tomorrow!/);
  assert.match(await p.evaluate(() => getComputedStyle(document.querySelector("#board .tile span")).filter), /blur/, "tiles are blurred");
  await p.click("#wfGiveUpNo");
  assert.strictEqual(await p.isHidden("#wfGiveUp"), true);
  assert.strictEqual(await p.evaluate(() => getComputedStyle(document.querySelector("#board .tile span")).filter), "none");
  await drag(p, W.findPath(g, keys[1], 6, 10));                // Cancel carries on with the game
  await until(p, () => document.querySelectorAll("#wfChips .wfchip").length === 2);
  await p.click("#wfStopBtn"); await p.click("#wfGiveUpYes");
  await p.waitForSelector("#wfResults:not([hidden])");
  assert.strictEqual(await p.textContent("#wfDoneTime"), "You Ended the Game");
  assert.match(await p.textContent("#wfDoneBreak"), /^Found 2 of 6 in \d+:\d\d$/);
  assert.strictEqual(await p.$$eval("#wfDoneWords li", (n) => n.length), 6);
  assert.strictEqual(await p.$$eval("#wfDoneWords li.missed", (n) => n.length), 4);
  assert.strictEqual(await p.textContent("#wfRank"), "Not ranked today. Try again tomorrow!");
  assert.strictEqual(await p.isHidden("#wfNickForm"), true);
  await p.evaluate(() => { delete Navigator.prototype.share; });
  await p.click("#wfShareBtn"); await until(p, () => document.getElementById("wfShareBtn").textContent === "Copied");
  assert.match(await p.evaluate(() => navigator.clipboard.readText()), /\n🏳️ Ended the game \(2 of 6 found\)\n/);
  await p.goto(U + "/wordfinder"); await p.waitForSelector("#wfResults:not([hidden])");   // still over after a reload
  assert.deepStrictEqual(p.errors, []);
});

test("the 10-minute limit: the clock turns red in the last minute and the game ends at 10:00", async () => {
  const { Client } = require("pg");
  const p = await page();
  await p.goto(U + "/wordfinder");
  await until(p, () => document.getElementById("goTopic").textContent.length > 0);
  await p.click("#go");
  await until(p, () => document.querySelector("#board .tile").firstChild.textContent !== "");
  const db = new Client({ connectionString: DB }); await db.connect();
  await db.query("update wf_plays set started_at = now() - interval '9 minutes 57 seconds' where id = (select max(id) from wf_plays)");
  await db.end();
  await p.reload();
  await until(p, () => document.getElementById("time").classList.contains("low"));
  assert.match(await p.textContent("#time"), /^9:5\d$/);
  await p.waitForSelector("#wfResults:not([hidden])", { timeout: 15000 });
  assert.strictEqual(await p.textContent("#wfDoneTime"), "Time's up!");
  assert.match(await p.textContent("#wfDoneBreak"), /^Found 0 of 6 in 10:00$/);
  assert.strictEqual(await p.$$eval("#wfDoneWords li.missed", (n) => n.length), 6);
  assert.deepStrictEqual(p.errors, []);
});

test("a keyboard player types the words, in Spanish, with reduced motion", async () => {
  const p = await page({ reducedMotion: "reduce" });
  await p.goto(U + "/es/wordfinder");
  await until(p, () => document.getElementById("goTopic").textContent.length > 0);
  assert.strictEqual(await p.textContent("#goTopic"), SAMPLES[0].es.topic);
  await p.focus("#go"); await p.keyboard.press("Enter");
  await until(p, () => !document.getElementById("wfType").hidden);
  for (const [i, w] of SAMPLES[0].es.words.entries()) {
    await p.focus("#wfTypeIn");
    assert.ok(await p.isVisible("#wfType"), "the typing box appears when it has focus");
    await p.keyboard.type(w.word.toLowerCase());                // accents and lower case are fine
    await p.keyboard.press("Enter");
    if (i < 5) await until(p, (n) => document.querySelectorAll("#wfChips .wfchip").length === n, i + 1);
    if (i === 0) {
      await until(p, () => document.getElementById("wfLive").textContent !== "");
      assert.match(await p.textContent("#wfLive"), /^Encontraste ARGENTINA\. 1 de 6\.$/);
      assert.strictEqual(await p.evaluate(() => document.getAnimations().length), 0, "no animations with reduced motion");
    }
  }
  await p.waitForSelector("#wfResults:not([hidden])");
  assert.match(await p.textContent("#wfDoneWords"), /PERÚ/);
  assert.match(await p.textContent("#wfRank"), /Añade un apodo/);
  assert.deepStrictEqual(p.errors, []);
});
