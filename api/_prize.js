// Brain Booster monthly prize: months run on US Eastern time. Each language (English, Spanish) has its own winner:
// the confirmed member with the highest single-round Brain Booster score that month (ties: whoever scored it first),
// unless an admin disqualified them or a rule below rules them out, in which case the next eligible player wins.
const L = require("./_lib.js");

const ZONE = "America/New_York";
const FIRST_MONTH = process.env.PRIZE_FIRST_MONTH || "2026-12";   // the first month with a prize (the setting is only for testing)
const MIN_PLAYERS = Number(process.env.PRIZE_MIN_PLAYERS) || 10;   // a language's prize is awarded only if this many members played that month
const monthOf = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit" }).format(d).slice(0, 7);
const validMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || "");
const addMonths = (m, n) => { const [y, mo] = m.split("-").map(Number), d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
// SQL: is `col` inside the month given by parameter `param` (YYYY-MM)? Worked out by the database in Eastern time.
const inMonth = (col, param) => `${col} >= ((${param} || '-01')::timestamp at time zone '${ZONE}') and ${col} < (((${param} || '-01')::date + interval '1 month')::timestamp at time zone '${ZONE}')`;

// Rules applied when picking a winner:
//  - at least MIN_PLAYERS confirmed members must have played Brain Booster in that language that month, or there's no prize;
//  - one prize per player per month: English is decided first, and its winner can't also win in Spanish;
//  - nobody wins two months in a row: last month's winners (in either language) are skipped;
//  - one household can't win two months in a row either: a player whose mailing address (from their account) matches
//    last month's winner's is skipped. Winners need an address on file to receive the prize; the admin dashboard checks
//    the household rule again when marking the prize claimed (sameHousehold()), in case an address was added later.
// Once a month is over its winner is locked in (status "winner"), so later months can be decided from it.
const LIVE = ["winner", "notified", "claimed"];
const ORDER = ["classic", "es"];

// how many members could have won: confirmed members (or everyone, without email) who scored in that month and language
async function playerCount(p, month, mode) {
  const r = await p.query(`select count(distinct g.player_id)::int n from games g join players pl on pl.id = g.player_id
                            where g.mode = $1 and g.game is null and g.score > 0 and (pl.email_verified or not $2) and ${inMonth("g.played_at", "$3")}`,
    [mode, L.MAIL_ON, month]);
  return r.rows[0].n;
}
async function pick(p, month, mode, exclude) {
  const r = await p.query(
    `select g.id, g.player_id, pl.address from games g join players pl on pl.id = g.player_id
      where g.mode = $1 and g.game is null and g.score > 0 and (pl.email_verified or not $2)
        and ${inMonth("g.played_at", "$3")}
        and not (g.player_id = any($4::uuid[]))
        and not exists (select 1 from prize_results x where x.month = $3 and x.mode = $1 and x.player_id = g.player_id and x.status = 'disqualified')
      order by g.score desc, g.played_at asc limit 1`, [mode, L.MAIL_ON, month, exclude]);
  return r.rows[0] || null;
}
// a winner's address: the copy saved when they claimed the prize, else the one in their account
async function winnerAddress(p, row) {
  if (row.address) return row.address;
  const a = (await p.query("select address from players where id = $1", [row.player_id])).rows[0];
  return a ? L.addressText(a.address) : "";
}
// a month's winning rows in every language (memo: one lookup per month and language per request)
async function winnersOf(p, month, memo) {
  const out = [];
  for (const mode of ORDER) { const w = await resolve(p, month, mode, memo); if (w) out.push(w); }
  return out;
}
// the winning row for a month and language: { player_id, game_id, status, address } or null
async function resolve(p, month, mode, memo) {
  if (month < FIRST_MONTH || month >= monthOf()) return null;      // only finished prize months have winners
  const key = month + "/" + mode;
  if (memo.has(key)) return memo.get(key);
  let row = (await p.query("select player_id, game_id, status, address from prize_results where month = $1 and mode = $2 and status = any($3)",
    [month, mode, LIVE])).rows[0] || null;
  if (!row && (await playerCount(p, month, mode)) >= MIN_PLAYERS) {
    const last = await winnersOf(p, addMonths(month, -1), memo), exclude = last.map((w) => w.player_id);
    const homes = (await Promise.all(last.map((w) => winnerAddress(p, w)))).map(addressKey).filter(Boolean);
    for (const m of ORDER.slice(0, ORDER.indexOf(mode))) { const w = await resolve(p, month, m, memo); if (w) exclude.push(w.player_id); }
    let g = null;
    for (let tries = 0; tries < 50; tries++) {                       // skip anyone from last month's winners' households
      g = await pick(p, month, mode, exclude);
      if (!g || !homes.includes(addressKey(L.addressText(g.address)))) break;
      exclude.push(g.player_id); g = null;
    }
    if (g) {
      await p.query(`insert into prize_results (month, mode, player_id, status, game_id) values ($1, $2, $3, 'winner', $4)
                     on conflict do nothing`, [month, mode, g.player_id, g.id]);
      row = (await p.query("select player_id, game_id, status, address from prize_results where month = $1 and mode = $2 and status = any($3)",
        [month, mode, LIVE])).rows[0] || null;
    }
  }
  memo.set(key, row);
  return row;
}
// the winner of one month in one language, ready to show (null if nobody eligible played)
async function winner(p, month, mode, withEmail, memo = new Map()) {
  const row = await resolve(p, month, mode, memo);
  if (!row) return null;
  const g = (await p.query(`select g.score, g.words, g.played_at, pl.screen_name, pl.email, pl.address from games g join players pl on pl.id = g.player_id
                             where g.id = $1`, [row.game_id])).rows[0];
  if (!g) return null;
  const out = { month, mode, screenName: g.screen_name, score: g.score, words: Array.isArray(g.words) ? g.words : [], at: new Date(g.played_at).getTime() };
  if (withEmail) Object.assign(out, { playerId: row.player_id, email: g.email, status: row.status, address: row.address || L.addressText(g.address) });
  return out;
}
// Forget locked-in winners that a change in `month` could affect (this month's other language and next month), unless they were
// already emailed. Called after a disqualification or reinstatement.
async function unlock(p, month) {
  await p.query("delete from prize_results where month = any($1) and status = 'winner'", [[month, addMonths(month, 1)]]);
}
// Mailing addresses compared loosely: case, punctuation, spacing, common abbreviations and unit words ("Apt 4" = "#4") don't matter;
// ZIP+4 counts as the ZIP.
const ABBR = { street: "st", avenue: "ave", road: "rd", drive: "dr", boulevard: "blvd", lane: "ln", court: "ct", place: "pl", terrace: "ter",
  circle: "cir", highway: "hwy", parkway: "pkwy", apartment: "", apt: "", suite: "", ste: "", unit: "", number: "", north: "n", south: "s", east: "e", west: "w" };
function addressKey(a) {
  return String(a || "").toLowerCase().replace(/(\d{5})-\d{4}/g, "$1").replace(/[#.,]/g, " ").split(/\s+/).filter(Boolean)
    .map((w) => (w in ABBR ? ABBR[w] : w)).filter(Boolean).join(" ");
}
// Is this address the same household as another month's winner? Returns that winner { month, screenName } or null.
async function sameHousehold(p, month, mode, address) {
  const key = addressKey(address); if (!key) return null;
  const r = await p.query(`select r.month, r.player_id, r.address, pl.screen_name from prize_results r join players pl on pl.id = r.player_id
                            where r.month = any($1) and r.status = any($2)`, [[addMonths(month, -1), addMonths(month, 1)], LIVE]);
  let hit = null;
  for (const x of r.rows) if (addressKey(await winnerAddress(p, x)) === key) { hit = x; break; }
  return hit ? { month: hit.month, screenName: hit.screen_name } : null;
}
// Addresses are kept only as long as the household rule needs them: until two months after the prize month ends.
const purgeAddresses = (p) => p.query("update prize_results set address = null where address is not null and month < $1", [addMonths(monthOf(), -2)]);

// finished prize months, newest first (at most `limit`)
function pastMonths(limit) {
  const out = []; let m = addMonths(monthOf(), -1);
  while (m >= FIRST_MONTH && out.length < limit) { out.push(m); m = addMonths(m, -1); }
  return out;
}
const monthName = (m, lang) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 15)).toLocaleDateString(lang === "es" ? "es" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });

module.exports = { ZONE, FIRST_MONTH, MIN_PLAYERS, playerCount, monthOf, validMonth, addMonths, inMonth, winner, unlock, addressKey, sameHousehold, purgeAddresses, pastMonths, monthName };
