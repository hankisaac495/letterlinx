// Records scripted gameplay clips of the real LetterLinx game for videos and tutorials.
//
//   node record.js plan [fromSeed] [toSeed]              try boards and list the words each would play
//   node record.js film <seed> [--skip=a,b] [--out=name.mp4] [--words=3]
//
// The game must be running locally first (repo root: npm run dev, then it serves http://localhost:3000).
// Set BASE_URL to film another address. Output goes to media/videos/ in the repository.
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path"), { execFileSync } = require("child_process");
const W = require("wordlist-english");

const args = process.argv.slice(2), MODE = args[0] || "plan";
const opt = (k, d) => { const a = args.find((x) => x.startsWith("--" + k + "=")); return a ? a.split("=")[1] : d; };
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SKIP = opt("skip", "").split(",").filter(Boolean);
const WORDS = +opt("words", 3);
// common English words only, so the clip plays words viewers recognise
const COMMON = [...W["english/10"], ...W["english/20"], ...W["english/35"]].filter((x) => /^[a-z]{4,8}$/.test(x));
// word lengths for each word played, shortest first: the last word is the big finish
const LENGTHS = [[4, 5], [5, 6], [6, 8], [6, 8], [6, 8]].slice(0, WORDS);

// fixed randomness so the same seed always deals the same Brain Booster board, plus an on-screen finger
const init = (seed) => `
  (() => { let a = ${seed} >>> 0; Math.random = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const T = 1795000000000; Date.now = () => T; })();
  localStorage.setItem("letterlinx.v1", JSON.stringify({ tourSeen: true, variant: "booster", audio: false, theme: "light" }));
  addEventListener("DOMContentLoaded", () => {
    const f = document.createElement("div");
    f.style.cssText = "position:fixed;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;z-index:99999;pointer-events:none;" +
      "background:rgba(255,255,255,.55);border:3px solid rgba(16,48,59,.75);box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:0;transition:opacity .25s, transform .12s;";
    document.body.appendChild(f);
    const mv = (e) => { f.style.left = e.clientX + "px"; f.style.top = e.clientY + "px"; };
    document.addEventListener("pointermove", mv, true);
    document.addEventListener("pointerdown", (e) => { mv(e); f.style.transform = "scale(.78)"; f.style.background = "rgba(255,255,255,.8)"; }, true);
    document.addEventListener("pointerup", () => { f.style.transform = ""; f.style.background = "rgba(255,255,255,.55)"; }, true);
    window.__finger = (on) => { f.style.opacity = on ? "1" : "0"; };
  });`;

// every common word on the board that the game also accepts, with its tile path
const finder = (common) => {
  const C = 6, R = 10, L = [...document.querySelectorAll("#board .tile span")].map((s) => s.textContent.toLowerCase());
  const D = new Set(window.LLX_WORDS.split("|")), words = new Set(common.filter((w) => D.has(w))), pre = new Set();
  for (const w of words) for (let i = 1; i <= w.length; i++) pre.add(w.slice(0, i));
  const adj = (i) => { const o = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const r = Math.floor(i / C) + dr, c = i % C + dc; if ((dr || dc) && r >= 0 && r < R && c >= 0 && c < C) o.push(r * C + c); } return o; };
  const found = new Map();
  const go = (p, s) => { if (!pre.has(s)) return; if (s.length >= 4 && words.has(s) && !found.has(s)) found.set(s, p.slice());
    if (s.length >= 8) return; for (const n of adj(p[p.length - 1])) if (!p.includes(n)) { p.push(n); go(p, s + L[n]); p.pop(); } };
  for (let i = 0; i < C * R; i++) go([i], L[i]);
  return [...found.entries()].map(([w, p]) => ({ w, p }));
};

async function run(seed, film) {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 });   // 1080x1920 frames
  const page = await ctx.newPage();
  await page.addInitScript(init(seed));
  await page.goto(BASE + "/");
  await page.waitForFunction(() => window.LLX_WORDS && document.querySelector("#go"));
  await page.waitForTimeout(600);
  const centre = (i) => page.evaluate((i) => { const r = document.querySelectorAll("#board .tile")[i].getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, i);
  let pos = [300, 600];
  const glide = async (x, y, ms) => { const n = Math.max(1, Math.round(ms / 16)), [x0, y0] = pos;
    for (let k = 1; k <= n; k++) { const e = k / n, s = e < .5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2; await page.mouse.move(x0 + (x - x0) * s, y0 + (y - y0) * s); if (film) await page.waitForTimeout(16); }
    pos = [x, y]; };
  const wait = (ms) => page.waitForTimeout(film ? ms : Math.min(ms, 1300));

  const frames = []; let cdp = null;
  if (film) {
    cdp = await ctx.newCDPSession(page);
    cdp.on("Page.screencastFrame", async (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch (e) {} });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
  }
  // GO screen, finger taps GO, board deals in
  await page.mouse.move(...pos); await wait(1300);
  await page.evaluate(() => window.__finger(true));
  const g = await page.evaluate(() => { const r = document.getElementById("go").getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await glide(g[0], g[1], 700); await wait(200);
  await page.mouse.down(); await wait(140); await page.mouse.up();
  pos = [g[0], g[1] + 1]; await page.mouse.move(...pos);
  await wait(1000);
  // trace each word, then let it score and the letters drop
  const plan = [];
  for (const [lo, hi] of LENGTHS) {
    const all = await page.evaluate(finder, COMMON);
    const fit = all.filter((x) => x.w.length >= lo && x.w.length <= hi && !plan.includes(x.w) && !SKIP.includes(x.w)).sort((a, b) => b.w.length - a.w.length);
    if (!fit.length) { plan.push("(none " + lo + "-" + hi + ")"); break; }
    const pick = fit[0]; plan.push(pick.w);
    const pts = []; for (const i of pick.p) pts.push(await centre(i));
    await glide(pts[0][0], pts[0][1], 650); await wait(150);
    await page.mouse.down(); await wait(120);
    for (const q of pts.slice(1)) await glide(q[0], q[1], film ? 230 : 40);
    await wait(film ? 420 : 50);
    await page.mouse.up();
    const last = pts[pts.length - 1]; pos = [last[0] + 30, last[1] + 40]; await page.mouse.move(...pos);
    await wait(1500);
  }
  await page.evaluate(() => window.__finger(false));
  await wait(1500);
  const score = await page.textContent("#score");
  if (film) await cdp.send("Page.stopScreencast");
  await b.close();
  return { plan, score, frames };
}

(async () => {
  if (MODE === "plan") {
    const from = +(args[1] || 1), to = +(args[2] || from + 11);
    for (let s = from; s <= to; s++) { const r = await run(s, false); console.log(`seed ${s}: ${r.plan.join(", ")}  (score ${r.score})`); }
    return;
  }
  const seed = +args[1];
  if (MODE !== "film" || !Number.isFinite(seed)) { console.log("usage: node record.js plan [from] [to]  |  node record.js film <seed> [--skip=a,b] [--out=name.mp4] [--words=3]"); process.exit(1); }
  const r = await run(seed, true);
  // keep each frame on screen for as long as it really was, then encode at a steady 30 fps
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "llx-frames-")), t0 = r.frames[0].t;
  let list = "ffconcat version 1.0\n";
  r.frames.forEach((f, i) => { const name = String(i).padStart(5, "0") + ".jpg"; fs.writeFileSync(path.join(dir, name), Buffer.from(f.data, "base64"));
    list += `file '${name}'\nduration ${((r.frames[i + 1] ? r.frames[i + 1].t : f.t + 0.5) - f.t).toFixed(4)}\n`; });
  list += `file '${String(r.frames.length - 1).padStart(5, "0")}.jpg'\n`;
  fs.writeFileSync(path.join(dir, "list.txt"), list);
  const out = path.resolve(__dirname, "../../media/videos", opt("out", "clip-seed-" + seed + ".mp4"));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"),
    "-vf", "fps=30,scale=1080:1920:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", out]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`seed ${seed}: ${r.plan.join(", ")}  (score ${r.score})  ${(r.frames[r.frames.length - 1].t - t0).toFixed(1)}s  →  ${out}`);
})();
