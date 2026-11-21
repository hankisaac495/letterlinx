// Linx WordFinder puzzle admin: month calendar, alerts, side-by-side English/Spanish editor with live checks and a
// board preview, approve/reject, swapping days and the backup pool. Loaded only when an admin opens the dashboard.
// window.LLX_WF_ADMIN(box, ctx) builds it inside `box`; ctx = { call }.
(function () {
  "use strict";
  const W = window.LLX_WF, LANGS = { en: "English", es: "Español" };
  const COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9"];
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (label, cls, fn) => { const b = el("button", "btn small " + (cls || ""), label); b.type = "button"; b.addEventListener("click", fn); return b; };
  const parse = (d) => { const p = d.split("-"); return new Date(+p[0], p[1] - 1, +p[2]); };
  const key = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const longDay = (d) => parse(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const shortDay = (d) => parse(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const newSeed = () => Math.random().toString(36).slice(2, 10);
  const STATUS = { approved: "Approved", draft: "Draft", backup: "Backup pool", rejected: "Rejected" };

  const CSS = `
.wfa { display: flex; flex-direction: column; gap: 12px; margin-top: 18px; }
.wfa h3 { margin: 0; font-size: 1.05rem; }
.wfa-alerts { background: var(--surface); border: 2px solid var(--bad); border-radius: 14px; padding: 12px 14px; font-size: .9rem; }
.wfa-alerts.ok { border-color: var(--good); }
.wfa-alerts p { margin: 0; font-weight: 700; color: var(--good); }
.wfa-alerts p.wfa-warn { margin-top: 8px; color: var(--bad); font-weight: 600; }
.wfa-alerts ul { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.wfa-alerts .linkbtn { padding: 0; display: inline; }
.wfa-bar { display: flex; align-items: center; gap: 10px; }
.wfa-bar strong { flex: 1; text-align: center; font-size: 1.05rem; }
.wfa-swap { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; background: var(--surface); border-radius: 12px; padding: 10px 12px; font-weight: 600; font-size: .9rem; }
.wfa-cal { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
.wfa-cal .wd { text-align: center; font-size: .7rem; font-weight: 700; color: var(--muted); }
.wfa-day { display: flex; flex-direction: column; gap: 3px; align-items: stretch; min-height: 74px; padding: 4px; border: 0; border-radius: 10px;
  background: var(--surface); color: var(--ink); text-align: left; font: inherit; cursor: pointer; min-width: 0; }
.wfa-day:disabled { opacity: .35; cursor: default; }
.wfa-day.today { box-shadow: inset 0 0 0 2px var(--brand); }
.wfa-day.picked { box-shadow: inset 0 0 0 3px var(--accent); }
.wfa-day .dn { display: flex; justify-content: space-between; align-items: baseline; font-size: .75rem; }
.wfa-day .dn span { color: var(--muted); font-size: .65rem; }
.pill { display: block; border-radius: 6px; padding: 1px 4px; font-size: .62rem; font-weight: 700; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pill.approved { background: color-mix(in srgb, var(--good) 22%, transparent); color: var(--ink); }
.pill.approved.auto { background: color-mix(in srgb, var(--good) 10%, transparent); border: 1px dashed var(--good); }
.pill.draft { background: color-mix(in srgb, #E69F00 28%, transparent); color: var(--ink); }
.pill.missing { border: 1.5px solid var(--bad); color: var(--bad); }
.pill.none { color: var(--muted); }
.wfa-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: .75rem; color: var(--muted); }
.wfa-legend span { display: inline-flex; align-items: center; gap: 5px; }
.wfa-legend i.pill { width: 18px; height: 12px; padding: 0; }
.wfa-pool .acts { align-items: center; flex-wrap: wrap; }
.wfa-pool input[type="date"] { width: auto; padding: 6px 8px; border-radius: 10px; border: 1.5px solid var(--line); background: var(--surface); color: var(--ink); font: inherit; font-size: .85rem; }
.wfa-ed { position: fixed; inset: 0; z-index: 60; background: color-mix(in srgb, #000 45%, transparent); overflow-y: auto; padding: 16px; }
.wfa-panel { max-width: 1100px; margin: 0 auto; background: var(--bg); border-radius: 18px; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.wfa-edhead { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.wfa-edhead h2 { margin: 0; font-size: 1.2rem; }
.wfa-cols { display: grid; grid-template-columns: 1fr; gap: 14px; }
@media (min-width: 860px) { .wfa-cols { grid-template-columns: 1fr 1fr; } }
.wfa-col { background: var(--surface); border-radius: 14px; padding: 14px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.wfa-colhead { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wfa-col select { background: var(--surface); border: 1.5px solid var(--line); border-radius: 12px; padding: 11px; font: inherit; color: var(--ink); }
.wfa-two { display: grid; grid-template-columns: 1fr auto; gap: 10px; }
.wfa-words { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.wfa-gen { background: var(--surface); border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
.wfa-gen .note { margin: 0; }
.wfa-genlist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; max-height: 260px; overflow-y: auto; font-size: .85rem; }
.wfa-genlist li { display: grid; grid-template-columns: 1.4em 4.5em 1fr; gap: 6px; }
.wfa-genlist .st { font-weight: 800; text-align: center; }
.wfa-genlist li.ok .st { color: var(--good); } .wfa-genlist li.problems .st, .wfa-genlist li.failed .st { color: var(--bad); }
.wfa-genlist li.writing { font-weight: 700; } .wfa-genlist li.waiting { color: var(--muted); }
.pill.problem { background: color-mix(in srgb, var(--bad) 16%, transparent); color: var(--ink); border: 1px dashed var(--bad); }
.wfa-ai { display: flex; gap: 4px; }
.wfa-ai .btn { padding: 4px 8px; font-size: .75rem; white-space: nowrap; }
.wfa-edhead .acts { display: flex; gap: 8px; }
.wfa-words li { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "w ai" "h h"; gap: 4px 6px; padding-left: 10px; border-left: 5px solid var(--wfc); }
.wfa-words li .w { grid-area: w; } .wfa-words li .h { grid-area: h; } .wfa-words li .wfa-ai { grid-area: ai; }
.wfa-words li.bad input { border-color: var(--bad); }
.wfa-words li { align-items: center; }
.wfa-words .lbl { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.wfa-words input { padding: 9px 10px; font-size: .9rem; }
.wfa-words .w input { text-transform: uppercase; font-weight: 700; }
.wfa-notes p { margin: 2px 0; font-size: .85rem; font-weight: 600; }
.wfa-notes .err, .wfa-board .err { color: var(--bad); }
.wfa-notes .warn { color: #b26b00; }
.wfa-notes .good { color: var(--good); }
.wfa-grid { display: grid; grid-template-columns: repeat(6, 34px); gap: 4px; justify-content: center; }
.wfa-grid span { position: relative; height: 34px; border-radius: 7px; background: var(--surface-2); display: grid; place-items: center; font-weight: 800; color: var(--ink); }
.wfa-grid span.on { color: #fff; }
.wfa-grid b { position: absolute; top: -5px; left: -5px; width: 15px; height: 15px; border-radius: 50%; background: var(--ink); color: var(--surface); font-size: .6rem; display: grid; place-items: center; }
.wfa-board .note { text-align: center; }
.wfa-col .acts { display: flex; gap: 8px; flex-wrap: wrap; }
.btn.small.solid { background: var(--brand); color: var(--surface); }
.btn.small.ok { background: var(--good); color: var(--on-state, #fff); }
`;

  window.LLX_WF_ADMIN = function (box, ctx) {
    if (!document.getElementById("wfaCss")) { const st = document.createElement("style"); st.id = "wfaCss"; st.textContent = CSS; document.head.appendChild(st); }
    const call = ctx.call;
    let data = null, month = null, swap = null, msgText = "", msgCls = "", editor = null;
    let gen = null;   // a month being written by Claude: { month, phase, list: [{ day, en, es, difficulty, state, note }], stop }

    const root = el("div", "wfa");
    box.textContent = ""; box.appendChild(root);
    const say = (text, cls) => { msgText = text; msgCls = cls || ""; render(); };

    async function load() {
      try {
        const r = await call("/api/wf-admin?month=" + (month || ""), "GET");
        if (!r.ok) { data = null; say(r.status === 403 ? "This account doesn't have admin access." : "Couldn't load the puzzles. Try again.", "err"); return; }
        data = r.data; month = data.month;
      } catch (e) { say("Can't reach the server. Check your connection and try again.", "err"); return; }
      render();
    }

    /* ---------- overview: alerts, calendar, backup pool ---------- */
    function render() {
      root.textContent = "";
      const head = el("div", "adminhead"); head.appendChild(el("h2", null, "Linx WordFinder puzzles")); root.appendChild(head);
      if (msgText) root.appendChild(el("p", "msg " + msgCls, msgText));
      if (!data) return;

      // alerts for the next 7 days
      const al = el("div", "wfa-alerts" + (data.alerts.length ? "" : " ok"));
      if (!data.alerts.length) al.appendChild(el("p", null, "✓ The next 7 days have approved puzzles in both languages."));
      else {
        // one line per day: which languages are missing (or only drafted) and what will fill them
        const days = [...new Set(data.alerts.map((a) => a.day))].sort();
        al.appendChild(el("strong", null, "Next 7 days: " + days.length + (days.length === 1 ? " day needs" : " days need") + " attention"));
        const ul = el("ul");
        days.forEach((d) => {
          const li = el("li"), here = data.alerts.filter((a) => a.day === d);
          const link = el("button", "linkbtn", shortDay(d) + " (#" + W.numberOf(d) + ")");
          link.type = "button"; link.addEventListener("click", () => openDay(d));
          li.append(link, " — " + here.map((a) => LANGS[a.lang] + (a.draft ? " draft not approved" : " missing") + " (" + (a.cover === "backup" ? "backup pool" : "sample") + " will be used)").join("; "));
          ul.appendChild(li);
        });
        al.appendChild(ul);
        const empty = ["en", "es"].filter((l) => data.alerts.some((a) => a.lang === l && a.cover === "sample")).map((l) => LANGS[l]);
        if (empty.length) al.appendChild(el("p", "wfa-warn", "The " + empty.join(" and ") + " backup pool" + (empty.length > 1 ? "s run" : " runs") + " out, so built-in sample puzzles fill the rest. Approve puzzles or add backups."));
      }
      root.appendChild(al);

      // month bar
      const first = parse(data.month + "-01");
      const bar = el("div", "wfa-bar");
      const prev = btn("‹", "", () => { month = key(new Date(first.getFullYear(), first.getMonth() - 1, 1)).slice(0, 7); load(); });
      const next = btn("›", "", () => { month = key(new Date(first.getFullYear(), first.getMonth() + 1, 1)).slice(0, 7); load(); });
      prev.setAttribute("aria-label", "Previous month"); next.setAttribute("aria-label", "Next month");
      prev.disabled = data.month <= data.launch.slice(0, 7);
      bar.append(prev, el("strong", null, first.toLocaleDateString("en-US", { month: "long", year: "numeric" })), next);
      bar.appendChild(swap
        ? btn("Cancel swap", "", () => { swap = null; render(); })
        : btn("Swap two days", "", () => { swap = { a: null, b: null }; msgText = ""; render(); }));
      root.appendChild(bar);
      if (swap) {
        const s = el("div", "wfa-swap");
        if (!swap.a) s.appendChild(el("span", null, "Tap the first day to swap."));
        else if (!swap.b) s.appendChild(el("span", null, shortDay(swap.a) + " selected. Tap the day to swap it with."));
        else {
          s.appendChild(el("span", null, "Swap the puzzles of " + longDay(swap.a) + " and " + longDay(swap.b) + " (both languages)?"));
          s.appendChild(btn("Swap", "solid", doSwap));
        }
        root.appendChild(s);
      }

      root.appendChild(drawGen(first));

      // calendar
      const cal = el("div", "wfa-cal");
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((w) => cal.appendChild(el("div", "wd", w)));
      for (let i = 0; i < first.getDay(); i++) cal.appendChild(el("span"));
      const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      for (let n = 1; n <= days; n++) {
        const d = key(new Date(first.getFullYear(), first.getMonth(), n)), before = d < data.launch;
        const cell = el("button", "wfa-day"); cell.type = "button"; cell.disabled = before;
        if (d === data.today) cell.classList.add("today");
        if (swap && (swap.a === d || swap.b === d)) cell.classList.add("picked");
        const top = el("div", "dn"); top.append(el("b", null, n)); if (!before) top.append(el("span", null, "#" + W.numberOf(d)));
        cell.appendChild(top);
        if (!before) for (const lang of ["en", "es"]) {
          const pz = data.puzzles.filter((x) => x.day === d && x.lang === lang);
          const live = pz.find((x) => x.status === "approved"), draft = pz.find((x) => x.status === "draft");
          const shown = live || draft, future = d >= data.today;
          const bad = !live && draft && draft.problems.length;
          const pill = el("span", "pill " + (live ? "approved" : bad ? "problem" : draft ? "draft" : future ? "missing" : "none"),
            lang.toUpperCase() + (shown ? " " + (shown.locked ? "🔒" : bad ? "⚠ " : "") + shown.topic : future ? " missing" : " —"));
          if (live && /sample|backup/.test(live.source)) pill.classList.add("auto");
          pill.title = shown ? LANGS[lang] + ": " + shown.topic + " · " + STATUS[shown.status] + (shown.source !== "manual" ? " · " + shown.source : "") + (shown.plays ? " · " + shown.plays + " plays" : "") : LANGS[lang] + ": no puzzle";
          cell.appendChild(pill);
        }
        cell.setAttribute("aria-label", longDay(d));
        cell.addEventListener("click", () => {
          if (!swap) return openDay(d);
          if (!swap.a) swap.a = d; else if (!swap.b && d !== swap.a) swap.b = d; else { swap.a = d; swap.b = null; }
          render();
        });
        cal.appendChild(cell);
      }
      root.appendChild(cal);
      const legend = el("div", "wfa-legend");
      [["approved", "Approved"], ["draft", "Draft (not live)"], ["problem", "Needs fixing"], ["missing", "Missing"], ["approved auto", "Filled from backup or sample"]].forEach(([c, t]) => {
        const s = el("span"); s.append(el("i", "pill " + c), t); legend.appendChild(s);
      });
      legend.appendChild(el("span", null, "🔒 live or played: can't be changed"));
      root.appendChild(legend);

      // backup pool
      const ph = el("div", "adminhead");
      ph.append(el("h3", null, "Backup pool"), el("span", "note", "English " + data.poolCount.en + " · Español " + data.poolCount.es));
      root.appendChild(ph);
      root.appendChild(el("p", "note", "Used automatically, oldest first, for any day without an approved puzzle. Keep at least 7 in each language."));
      root.appendChild(btn("Add backup puzzle", "solid", () => openEditor({ pool: true })));
      const list = el("ul", "plain wfa-pool");
      if (!data.pool.length) list.appendChild(el("li", "empty", "The backup pool is empty."));
      data.pool.forEach((pz) => {
        const li = el("li", "pcard");
        const name = el("div", "name", pz.topic); name.appendChild(el("span", "tag", LANGS[pz.lang])); name.appendChild(el("span", "tag", pz.difficulty));
        li.appendChild(name);
        const acts = el("div", "acts");
        acts.appendChild(btn("Edit", "", () => openEditor({ pool: true, ids: { [pz.lang]: pz.id } })));
        const date = el("input"); date.type = "date"; date.min = data.today; date.setAttribute("aria-label", "Day to assign " + pz.topic + " to");
        acts.append(date, btn("Assign to day", "", async () => {
          if (!date.value) return say("Pick a day first.", "err");
          const r = await post({ action: "assign", id: pz.id, day: date.value });
          if (r) { say(pz.topic + " (" + LANGS[pz.lang] + ") is now the puzzle for " + longDay(date.value) + ".", "ok"); load(); }
        }));
        li.appendChild(acts); list.appendChild(li);
      });
      root.appendChild(list);
    }

    async function post(body) {
      try {
        const r = await call("/api/wf-admin", "POST", body);
        if (r.ok) return r.data;
        say((r.data && r.data.message) || "That didn't work. Reload and try again.", "err");
      } catch (e) { say("Can't reach the server. Check your connection and try again.", "err"); }
      return null;
    }
    async function doSwap() {
      const s = swap; swap = null;
      if (await post({ action: "swap", a: s.a, b: s.b })) { say("Swapped " + longDay(s.a) + " and " + longDay(s.b) + ".", "ok"); load(); }
    }

    /* ---------- writing a month with Claude ----------
       One request plans the topics, then one request per day writes both languages. Each day is saved as a draft;
       a day whose result breaks a rule gets one more attempt with the problems listed, then is saved for fixing. */
    function drawGen(first) {
      const box = el("div", "wfa-gen");
      const name = first.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      if (!data.ai) {
        box.appendChild(el("p", "note", "Writing puzzles with Claude is switched off until ANTHROPIC_API_KEY is added in Vercel (Settings → Environment Variables) and the site is redeployed."));
        const b = btn("Write " + name + " with Claude", "", () => {}); b.disabled = true; box.appendChild(b);
        return box;
      }
      if (!gen || gen.month !== data.month) {
        box.appendChild(el("p", "note", "Claude writes draft puzzles (both languages) for every empty day of " + name + " from today on, avoiding topics used in the last 90 days. About 10 cents a day. Nothing goes live until you approve it."));
        box.appendChild(btn("Write " + name + " with Claude", "solid", startGen));
        return box;
      }
      const done = gen.list.filter((x) => x.state !== "waiting" && x.state !== "writing").length;
      box.appendChild(el("strong", null, gen.phase === "planning" ? "Planning topics for " + name + "…"
        : gen.phase === "writing" ? "Writing day " + Math.min(done + 1, gen.list.length) + " of " + gen.list.length + "…"
        : gen.phase === "stopped" ? "Stopped after " + done + " of " + gen.list.length + " days."
        : gen.phase === "failed" ? "Stopped: " + gen.error
        : !gen.list.length ? "Nothing to write for " + name + "."
        : "Done: " + gen.list.filter((x) => x.state === "ok").length + " ready to review, " + gen.list.filter((x) => x.state === "problems").length + " need fixing, " + gen.list.filter((x) => x.state === "failed").length + " failed."));
      if (gen.note) box.appendChild(el("p", "note", gen.note));
      if (gen.list.length) {
        const ul = el("ul", "wfa-genlist");
        gen.list.forEach((x) => {
          const li = el("li", x.state);
          li.append(el("span", "st", { waiting: "·", writing: "…", ok: "✓", problems: "⚠", failed: "✕", skipped: "–" }[x.state]),
            el("span", "d", shortDay(x.day)), el("span", "t", (x.en || "?") + " / " + (x.es || "?") + (x.note ? " — " + x.note : "")));
          ul.appendChild(li);
        });
        box.appendChild(ul);
      }
      const acts = el("div", "acts");
      if (gen.phase === "planning" || gen.phase === "writing") acts.appendChild(btn("Stop", "", () => { gen.stop = true; }));
      else acts.appendChild(btn("Close", "", () => { gen = null; render(); }));
      box.appendChild(acts);
      return box;
    }
    async function startGen() {
      const g = gen = { month: data.month, phase: "planning", list: [], stop: false };
      render();
      const plan = await aiPost({ action: "ai_plan", month: g.month });
      if (gen !== g) return;
      if (!plan) { g.phase = "failed"; g.error = msgText; msgText = ""; return render(); }
      if (plan.partial && plan.partial.length) g.note = "Skipped " + plan.partial.map(shortDay).join(", ") + ": one language already has a puzzle. Use the editor for those.";
      if (!plan.topics.length) { g.phase = "done"; g.note = (g.note ? g.note + " " : "") + "Every day from today on already has puzzles."; return render(); }
      g.list = plan.topics.map((x) => ({ ...x, state: "waiting" }));
      g.phase = "writing"; render();
      for (const x of g.list) {
        if (g.stop) { g.phase = "stopped"; break; }
        x.state = "writing"; render();
        let r = await aiPost({ action: "ai_day", save: false, day: x.day, en: x.en, es: x.es, difficulty: x.difficulty });
        // a result that breaks a rule gets one more try with the problems spelled out
        const problems = r ? [...(r.en.ok ? [] : r.en.errors.map((e) => "English: " + e)), ...(r.es.ok ? [] : r.es.errors.map((e) => "Spanish: " + e))] : [];
        if (r && problems.length && !g.stop) r = await aiPost({ action: "ai_day", save: true, day: x.day, en: x.en, es: x.es, difficulty: x.difficulty, fix: problems });
        else if (r) r = await saveGenerated(x, r);
        if (gen !== g) return;
        if (!r) { x.state = "failed"; x.note = msgText; msgText = ""; }
        else if (r.skipped) x.state = "skipped";
        else {
          x.en = (r.en.puzzle && r.en.puzzle.topic) || x.en; x.es = (r.es.puzzle && r.es.puzzle.topic) || x.es;
          x.state = r.en.ok && r.es.ok ? "ok" : "problems";
          if (x.state === "problems") x.note = [...r.en.errors, ...r.es.errors][0];
        }
        render();
      }
      if (g.phase === "writing") g.phase = "done";
      render(); load();
    }
    // the first attempt is checked before saving, so a good result is stored straight away without a second call
    async function saveGenerated(x, r) {
      return aiPost({ action: "ai_day", save: true, day: x.day, en: r.en.puzzle.topic, es: r.es.puzzle.topic, difficulty: x.difficulty, reuse: { en: r.en, es: r.es } });
    }
    async function aiPost(body) {
      try {
        const r = await call("/api/wf-admin", "POST", body, 62000);
        if (r.ok) return r.data;
        msgText = (r.data && r.data.message) || "Claude couldn't write this one. Try again.";
      } catch (e) { msgText = "No answer from the server (it may have timed out). Try again."; }
      return null;
    }

    /* ---------- editor: one day (English and Spanish side by side) or a backup puzzle ---------- */
    function openDay(d) {
      const ids = {};
      for (const lang of ["en", "es"]) {
        const pz = data.puzzles.filter((x) => x.day === d && x.lang === lang);
        const shown = pz.find((x) => x.status === "approved") || pz.find((x) => x.status === "draft");
        if (shown) ids[lang] = shown.id;
      }
      openEditor({ day: d, ids });
    }
    async function openEditor(opts) {
      editor = { day: opts.day || null, pool: !!opts.pool, cols: {} };
      const langs = opts.pool && opts.ids ? Object.keys(opts.ids) : ["en", "es"];
      for (const lang of langs) {
        let pz = null;
        const id = opts.ids && opts.ids[lang];
        if (id) { try { const r = await call("/api/wf-admin?id=" + id, "GET"); if (r.ok) pz = r.data; } catch (e) {} }
        editor.cols[lang] = {
          lang, pz, dirty: false, msg: "", msgCls: "",
          form: pz ? { topic: pz.topic, difficulty: pz.difficulty, words: pz.words.map((w) => ({ ...w })), seed: pz.seed }
            : { topic: "", difficulty: "medium", words: Array.from({ length: W.LIMITS.words }, () => ({ word: "", hint: "" })), seed: newSeed() },
        };
      }
      drawEditor();
    }
    function closeEditor() {
      if (editor && Object.values(editor.cols).some((c) => c.dirty) && !confirm("Close without saving your changes?")) return;
      editor = null; overlay.hidden = true; load();
    }

    const overlay = el("div", "wfa-ed"); overlay.hidden = true; document.body.appendChild(overlay);
    overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true");
    overlay.addEventListener("keydown", (e) => { if (e.key === "Escape") closeEditor(); });

    function drawEditor() {
      overlay.textContent = ""; overlay.hidden = false;
      const panel = el("div", "wfa-panel"); overlay.appendChild(panel);
      const head = el("div", "wfa-edhead");
      const title = editor.pool ? "Backup puzzle" : longDay(editor.day) + " · #" + W.numberOf(editor.day);
      const tools = el("div", "acts");
      const open = Object.values(editor.cols).filter((c) => !(c.pz && c.pz.locked));
      if (open.length) {
        const ai = btn(editor.busy ? "Claude is writing…" : "✨ Write with Claude", "", writeWithClaude);
        ai.disabled = !data.ai || !!editor.busy;
        ai.title = data.ai ? "Fills in " + open.map((c) => LANGS[c.lang]).join(" and ") + " using the topics typed (or Claude's choice if empty). Not saved until you save." : "Add ANTHROPIC_API_KEY in Vercel to use Claude.";
        tools.appendChild(ai);
      }
      tools.appendChild(btn("Close", "", closeEditor));
      head.append(el("h2", null, title), tools);
      panel.appendChild(head);
      panel.setAttribute("aria-label", title);
      if (editor.aiMsg) panel.appendChild(el("p", "msg " + editor.aiCls, editor.aiMsg));
      if (!editor.pool) panel.appendChild(el("p", "note", "Each language is saved and approved on its own. Saving changes to an approved puzzle takes it back to draft until it's approved again."));
      else panel.appendChild(el("p", "note", "Backup puzzles have no day; they fill any day that has no approved puzzle. Each language is a separate backup."));
      const cols = el("div", "wfa-cols"); panel.appendChild(cols);
      for (const c of Object.values(editor.cols)) cols.appendChild(drawCol(c));
      panel.querySelector("input:not([disabled])")?.focus();
    }

    async function writeWithClaude() {
      const cols = Object.values(editor.cols).filter((c) => !(c.pz && c.pz.locked)), ed = editor;
      const first = cols[0].form, get = (l) => (editor.cols[l] ? editor.cols[l].form.topic : "");
      ed.busy = true; ed.aiMsg = ""; drawEditor();
      const r = await aiPost({ action: "ai_day", save: false, day: editor.day || undefined, en: get("en"), es: get("es"), difficulty: first.difficulty });
      if (editor !== ed) return;
      ed.busy = false;
      if (!r) { ed.aiMsg = msgText; ed.aiCls = "err"; msgText = ""; return drawEditor(); }
      for (const c of cols) {
        const x = r[c.lang];
        c.form.topic = x.puzzle.topic; c.form.words = x.puzzle.words.slice(0, 6);
        while (c.form.words.length < 6) c.form.words.push({ word: "", hint: "" });
        c.form.seed = x.seed; c.dirty = true; c.msg = ""; 
      }
      ed.aiMsg = "Claude's suggestion is filled in below. Check it, change anything you like, then save."; ed.aiCls = "ok";
      drawEditor();
    }

    function drawCol(c) {
      const col = el("section", "wfa-col"), pz = c.pz, locked = pz && pz.locked;
      col.dataset.lang = c.lang;
      const h = el("div", "wfa-colhead"); h.appendChild(el("h3", null, LANGS[c.lang]));
      if (pz) h.appendChild(el("span", "tag " + (pz.status === "approved" ? "ok" : ""), STATUS[pz.status] + (pz.source !== "manual" ? " · " + pz.source : "")));
      else h.appendChild(el("span", "tag", "New"));
      if (pz && pz.plays) h.appendChild(el("span", "tag", pz.plays + (pz.plays === 1 ? " play" : " plays")));
      col.appendChild(h);
      if (locked) col.appendChild(el("p", "note", "🔒 Live or already played, so it can't be changed."));

      const f = c.form;
      const row = el("div", "wfa-two");
      const topic = field("Topic", f.topic, (v) => { f.topic = v; }, { maxLength: W.LIMITS.maxTopic });
      const diff = el("label"); diff.append("Difficulty");
      const sel = el("select"); W.DIFFICULTIES.forEach((d) => { const o = el("option", null, d[0].toUpperCase() + d.slice(1)); o.value = d; sel.appendChild(o); });
      sel.value = f.difficulty; sel.disabled = locked;
      sel.addEventListener("change", () => { f.difficulty = sel.value; c.dirty = true; check(); });
      diff.appendChild(sel);
      row.append(topic, diff); col.appendChild(row);

      const words = el("ol", "wfa-words");
      f.words.forEach((w, i) => {
        const li = el("li"); li.style.setProperty("--wfc", COLORS[i]);
        li.append(field("Word " + (i + 1), w.word, (v) => { w.word = v; }, { maxLength: 16, cls: "w", ph: "Word" }),
          field("Hint " + (i + 1), w.hint, (v) => { w.hint = v; }, { maxLength: W.LIMITS.maxHint, cls: "h", ph: "Hint" }));
        // ask Claude for a different word (with its hint), or just a new hint for this word
        const ai = el("div", "wfa-ai");
        const one = (part, label, aria) => {
          const b = btn(label, "", async () => {
            if (!f.topic.trim()) { c.msg = "Type the topic first."; c.msgCls = "err"; return redraw(); }
            b.disabled = true; b.textContent = "…";
            const r = await aiPost({ action: "ai_item", lang: c.lang, topic: f.topic, words: f.words, index: i, part });
            if (!r) { c.msg = msgText; c.msgCls = "err"; msgText = ""; return redraw(); }
            w.word = r.word; w.hint = r.hint; c.dirty = true; c.msg = ""; redraw();
          });
          b.title = aria; b.setAttribute("aria-label", aria + " (" + (i + 1) + ")");
          b.disabled = locked || !data.ai || (part === "hint" && !w.word.trim());
          return b;
        };
        ai.append(one("word", "↻ word", "New word from Claude"), one("hint", "↻ hint", "New hint from Claude"));
        li.appendChild(ai);
        words.appendChild(li);
      });
      col.appendChild(words);

      const notes = el("div", "wfa-notes"); col.appendChild(notes);
      const prev = el("div", "wfa-board"); col.appendChild(prev);
      const tools = el("div", "acts");
      const shuffle = btn("Shuffle board", "", () => { f.seed = newSeed(); c.dirty = true; check(); });
      shuffle.disabled = locked;
      tools.appendChild(shuffle);
      col.appendChild(tools);
      const msg = el("p", "msg " + c.msgCls, c.msg); col.appendChild(msg);
      const acts = el("div", "acts"); col.appendChild(acts);

      function field(label, value, set, o) {
        const l = el("label", o.cls || ""); const span = el("span", "lbl", label); l.appendChild(span);
        const inp = el("input"); inp.type = "text"; inp.value = value || ""; inp.maxLength = o.maxLength; inp.disabled = locked;
        if (o.ph) inp.placeholder = o.ph; inp.autocomplete = "off"; inp.spellcheck = o.cls !== "w";
        inp.addEventListener("input", () => { set(inp.value); c.dirty = true; check(); });
        l.appendChild(inp); return l;
      }

      // live checks and board preview
      let v = null, board = null;
      function check() {
        v = W.validatePuzzle({ topic: f.topic, difficulty: f.difficulty, words: f.words }, c.lang);
        notes.textContent = "";
        const filled = f.words.filter((w) => w.word.trim()).length;
        const errs = filled || f.topic ? v.errors : [];
        errs.forEach((e) => notes.appendChild(el("p", "err", "✕ " + e.message)));
        v.warnings.forEach((e) => notes.appendChild(el("p", "warn", "! " + e.message)));
        if (v.ok) notes.appendChild(el("p", "good", "✓ Meets the rules · " + v.totalLetters + " of " + W.LIMITS.maxTotal + " letters"));
        col.querySelectorAll(".wfa-words li").forEach((li, i) => li.classList.toggle("bad", errs.some((e) => e.field === "words." + i || e.field === "hints." + i)));
        board = v.ok ? W.generateBoard(f.words, c.lang, f.seed) : null;
        drawBoard();
        drawActs();
      }
      function drawBoard() {
        prev.textContent = "";
        if (!board) { prev.appendChild(el("p", "note", "The board preview appears once all six words meet the rules.")); return; }
        if (!board.ok) { prev.appendChild(el("p", "err", "✕ " + board.error)); return; }
        const owner = new Array(board.grid.length).fill(-1), start = {};
        board.paths.forEach((path, i) => { path.forEach((t) => { owner[t] = i; }); start[path[0]] = i + 1; });
        const g = el("div", "wfa-grid");
        board.grid.forEach((l, i) => {
          const t = el("span", owner[i] >= 0 ? "on" : "", l);
          if (owner[i] >= 0) t.style.background = COLORS[owner[i]];
          if (start[i]) t.appendChild(el("b", null, start[i]));
          g.appendChild(t);
        });
        prev.appendChild(g);
        prev.appendChild(el("p", "note", board.shared + " shared tiles · " + board.filler.length + " filler tiles"));
      }
      function drawActs() {
        acts.textContent = "";
        if (locked) return;
        const st = pz ? pz.status : null, canSave = v && v.ok && board && board.ok;
        const save = btn(pz ? "Save" : editor.pool ? "Add to backup pool" : "Save draft", "solid", () => save_());
        save.disabled = !canSave || !c.dirty; acts.appendChild(save);
        if (!editor.pool && (st === "draft" || !pz)) {
          const ap = btn("Approve", "ok", async () => { if (c.dirty || !pz) { if (!(await save_(true))) return; } act("approve", "Approved."); });
          ap.disabled = !canSave || editor.day < data.today; acts.appendChild(ap);
        }
        if (st === "approved") acts.appendChild(btn("Unapprove", "", () => act("unapprove", "Back to draft.")));
        if (pz && st !== "backup") acts.appendChild(btn("Move to backup pool", "", () => act("backup", "Moved to the backup pool.")));
        if (pz && st !== "rejected") acts.appendChild(btn("Reject", "danger", () => act("reject", "Rejected. It won't be used.")));
      }
      async function save_(quiet) {
        const body = { action: "save", id: pz ? pz.id : undefined, lang: c.lang, topic: f.topic, difficulty: f.difficulty, words: f.words, seed: f.seed };
        if (editor.pool) body.pool = true; else body.day = editor.day;
        const r = await post(body);
        if (!r) { c.msg = msgText; c.msgCls = "err"; msgText = ""; redraw(); return null; }
        c.pz = r; c.dirty = false; c.msg = quiet ? "" : pz && pz.status === "approved" ? "Saved as a draft. Approve it again to put it live." : "Saved."; c.msgCls = "ok";
        redraw(); return r;
      }
      async function act(action, done) {
        const r = await post({ action, id: c.pz.id });
        if (!r) { c.msg = msgText; c.msgCls = "err"; msgText = ""; redraw(); return; }
        c.pz = r; c.msg = done; c.msgCls = "ok";
        if (action === "backup" && !editor.pool) { c.pz = null; c.msg = "Moved to the backup pool. This day now has no " + LANGS[c.lang] + " puzzle."; c.form = { topic: "", difficulty: "medium", words: Array.from({ length: 6 }, () => ({ word: "", hint: "" })), seed: newSeed() }; }
        redraw();
      }
      function redraw() { const cur = overlay.querySelector('.wfa-col[data-lang="' + c.lang + '"]'); if (cur) cur.replaceWith(drawCol(c)); }
      check();
      return col;
    }

    load();
    return { reload: load };
  };
})();
