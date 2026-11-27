// Brain Booster monthly prize end-to-end: a real browser and the local server against a test database.
//   E2E_DATABASE_URL=postgres://user:pass@localhost:5432/empty_test_db  npm run e2e
// Covers the winner rules (back-to-back wins, same household, one prize per month, at least N players, disqualify and
// reinstate), the optional mailing address on the Account screen, claiming in the admin dashboard, and the prize overlay.
// Everything it adds to the database is removed at the end.
const test = require("node:test"), assert = require("node:assert"), path = require("path"), { spawn } = require("child_process");
const { chromium } = require("playwright");
const { Client } = require("pg");

const DB = process.env.E2E_DATABASE_URL;
const PORT = 3600 + Math.floor(Math.random() * 300), U = "http://localhost:" + PORT;
const ADMIN = { email: "prize-admin@e2e.test", password: "e2e-password-1", screenName: "PrizeBoss" };
const P = require("../../api/_prize.js");
const now = P.monthOf(), m1 = P.addMonths(now, -1), m2 = P.addMonths(now, -2);
const at = (m, day) => m + "-" + String(day).padStart(2, "0") + "T15:00:00Z";
const OAK = { street: "12 Oak Street", line2: "Apt 4", city: "Fairfax", state: "VA", zip: "22030" };

let server, browser, db;
test.before(async () => {
  if (!DB) throw new Error("Set E2E_DATABASE_URL to an empty test database.");
  server = spawn(process.execPath, [path.join(__dirname, "../../dev-server.js")], { env: { ...process.env, PORT: String(PORT), DATABASE_URL: DB,
    ADMIN_EMAILS: ADMIN.email, RESEND_API_KEY: "", PRIZE_FIRST_MONTH: m2, PRIZE_MIN_PLAYERS: "3" }, stdio: "inherit" });
  for (let i = 0; i < 50; i++) { try { await fetch(U + "/api/leaderboard"); break; } catch (e) { await new Promise((ok) => setTimeout(ok, 200)); } }
  browser = await chromium.launch();
  db = new Client({ connectionString: DB }); await db.connect();
});
test.after(async () => {
  if (db) { await db.query("delete from players where email like '%@prize.e2e' or email = $1", [ADMIN.email]); await db.query("delete from prizes where month = any($1)", [[now, P.addMonths(now, 1)]]); await db.end(); }
  if (browser) await browser.close(); if (server) server.kill();
});

async function page(opts) {
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, ...(opts || {}) })).newPage();
  p.errors = []; p.on("pageerror", (e) => p.errors.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.addInitScript(() => { if (!localStorage.getItem("letterlinx.v1")) localStorage.setItem("letterlinx.v1", JSON.stringify({ tourSeen: true, variant: "booster" })); });
  return p;
}
const api = (p, url, method, body) => p.evaluate(async ([u, m, b]) => { const r = await fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, data: await r.json() }; }, [url, method, body]);
async function player(name, address) {
  const r = await db.query("insert into players (first_name, email, screen_name, password_hash, email_verified, address) values ($1, $2, $1, 'x', true, $3) returning id",
    [name, name.toLowerCase() + "@prize.e2e", address ? JSON.stringify(address) : null]);
  return r.rows[0].id;
}
const play = (id, mode, score, when) => db.query("insert into games (player_id, mode, score, words, played_at) values ($1, $2, $3, '[\"brain\",\"boost\"]', $4)", [id, mode, score, when]);

test("monthly winners follow the rules, and the admin can claim, disqualify and reinstate", async () => {
  const bea = await player("Bea", OAK), dee = await player("Dee", { ...OAK, street: "12 oak st.", line2: "#4" }), ace = await player("Ace"), cam = await player("Cam"), lupe = await player("Lupe");
  // two months ago: Bea wins (3 players)
  await play(bea, "classic", 300, at(m2, 10)); await play(cam, "classic", 50, at(m2, 11)); await play(dee, "classic", 40, at(m2, 12));
  // last month: Bea can't win back to back, Dee shares her address, so Ace wins English; Ace can't also win Spanish
  await play(bea, "classic", 400, at(m1, 5)); await play(dee, "classic", 350, at(m1, 6)); await play(ace, "classic", 310, at(m1, 7)); await play(cam, "classic", 200, at(m1, 8));
  await play(ace, "es", 500, at(m1, 9)); await play(lupe, "es", 150, at(m1, 10));     // only 2 Spanish players: no Spanish prize yet
  await play(cam, "classic", 180, at(now, 1));

  const p = await page(); await p.goto(U + "/");
  const win = async (mode) => (await api(p, "/api/prize?winners=1&mode=" + mode, "GET")).data.winners.map((w) => w.month + " " + w.screenName);
  assert.deepStrictEqual(await win("classic"), [m1 + " Ace", m2 + " Bea"]);
  assert.deepStrictEqual(await win("es"), [], "fewer than the minimum players: no Spanish prize");

  // the admin signs up with an address on the Account screen
  const a = await page({ viewport: { width: 1100, height: 1400 } }); await a.goto(U + "/"); await a.click('nav button[data-go="account"]');
  await a.fill("#fFirst", "Pat"); await a.fill("#fEmail", ADMIN.email); await a.fill("#fScreen", ADMIN.screenName); await a.fill("#fPass", ADMIN.password);
  await a.fill("#fStreet", "1 Main St"); await a.click("#acctSave");
  await a.waitForFunction(() => /ZIP/.test(document.getElementById("acctMsg").textContent));     // a partial address is refused
  await a.fill("#fCity", "McLean"); await a.selectOption("#fState", "VA"); await a.fill("#fZip", "22101"); await a.click("#acctSave");
  await a.waitForFunction(() => !document.getElementById("adminOpen").hidden);
  assert.deepStrictEqual((await db.query("select address from players where email = $1", [ADMIN.email])).rows[0].address, { street: "1 Main St", line2: "", city: "McLean", state: "VA", zip: "22101" });

  // claiming needs an address in the winner's account
  let r = await api(a, "/api/prize", "POST", { action: "claim", month: m1, mode: "classic" });
  assert.strictEqual(r.status, 400); assert.strictEqual(r.data.error, "no_address");
  // disqualifying Ace hands English to Cam; reinstating gives it back
  r = await api(a, "/api/prize", "POST", { action: "disqualify", month: m1, mode: "classic", playerId: ace }); assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(await win("classic"), [m1 + " Cam", m2 + " Bea"]);
  await api(a, "/api/prize", "POST", { action: "reinstate", month: m1, mode: "classic", playerId: ace });
  assert.deepStrictEqual(await win("classic"), [m1 + " Ace", m2 + " Bea"]);
  // a third Spanish player: now Spanish has a prize, which skips Ace (he won English) and goes to Lupe
  await play(cam, "es", 120, at(m1, 12)); await db.query("delete from prize_results where month = $1 and mode = 'es'", [m1]);
  assert.deepStrictEqual(await win("es"), [m1 + " Lupe"]);

  // Ace adds an address; the admin marks the prize claimed in the dashboard
  await db.query("update players set address = $1 where id = $2", [JSON.stringify({ street: "77 Elm Avenue", line2: "", city: "Austin", state: "TX", zip: "73301" }), ace]);
  await a.goto(U + "/?r=" + Date.now() + "#admin"); await a.waitForSelector("#prizeAdmin .pa-win");
  await a.locator('#prizeAdmin .pa-win:has-text("Ace") button:has-text("Mark claimed")').click();
  await a.waitForFunction(() => /claimed ✓/.test(document.getElementById("prizeAdmin").textContent));
  assert.match((await db.query("select address from prize_results where month = $1 and mode = 'classic' and player_id = $2", [m1, ace])).rows[0].address, /77 Elm Avenue/);
  // Lupe's address turns out to be Bea's household: flagged in the dashboard, and claiming is refused
  await db.query("update players set address = $1 where id = $2", [JSON.stringify({ ...OAK, street: "12 Oak St", line2: "Unit 4" }), lupe]);
  await a.goto(U + "/?r=" + Date.now() + "#admin"); await a.waitForSelector("#prizeAdmin .pa-win");
  assert.match(await a.textContent("#prizeAdmin"), /Same address as Bea/);
  r = await api(a, "/api/prize", "POST", { action: "claim", month: m1, mode: "es" });
  assert.strictEqual(r.status, 409); assert.strictEqual(r.data.error, "same_household");
  assert.deepStrictEqual(a.errors, []);

  // a player: the prize overlay shows this month's prize and how many have played so far
  await api(a, "/api/prize", "POST", { action: "save", month: now, title: "$25 test gift card" });
  const g = await page(); await g.goto(U + "/"); await g.click("#goPrize");
  await g.waitForFunction(() => /test gift card/.test(document.getElementById("prizeImg").textContent));
  assert.match(await g.textContent("#prizeCount"), /^1 of 3 players/);
  await g.click("#prizeClose"); await g.click('nav button[data-go="leaderboard"]');
  await g.waitForFunction(() => document.querySelectorAll("#lbMonths .monthbtn").length === 2);
  await g.click("#lbMonths .monthbtn"); assert.match(await g.textContent("#modalMeta"), /^Ace/);
  assert.deepStrictEqual(g.errors, []);
});
