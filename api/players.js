// Shared leaderboard for LetterLinx, stored in Upstash Redis (Vercel Marketplace).
// Needs KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
// Without them the endpoint answers 503 and the game keeps scores on the device only.
const crypto = require("crypto");

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const PLAYERS = "llx:players"; // hash: player id -> {screenName, best, key}
const NAMES = "llx:names";     // hash: lowercased screen name -> player id
const MAX_SCORE = 5000;

async function redis(...cmd) {
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.error || "redis " + r.status);
  return j.result;
}
const hash = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const parse = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };

module.exports = async (req, res) => {
  res.setHeader("cache-control", "no-store");
  if (!URL_ || !TOKEN) return res.status(503).json({ error: "not_configured" });
  try {
    if (req.method === "GET") {
      const flat = (await redis("HGETALL", PLAYERS)) || [];
      const players = [];
      for (let i = 0; i < flat.length; i += 2) {
        const p = parse(flat[i + 1]);
        if (p) players.push({ id: flat[i], screenName: p.screenName, best: p.best });
      }
      players.sort((a, b) => b.best - a.best);
      return res.status(200).json({ players: players.slice(0, 500) });
    }

    const body = typeof req.body === "string" ? parse(req.body) : req.body;
    const { id, secret } = body || {};
    if (!/^[a-z0-9]{16,64}$/i.test(id || "") || typeof secret !== "string" || secret.length < 16 || secret.length > 128)
      return res.status(400).json({ error: "bad_request" });
    const existing = parse(await redis("HGET", PLAYERS, id));
    if (existing && existing.key !== hash(secret)) return res.status(403).json({ error: "forbidden" });

    if (req.method === "POST") {
      const score = Math.floor(Number(body.best));
      if (!Number.isFinite(score) || score < 0 || score > MAX_SCORE) return res.status(400).json({ error: "bad_score" });
      let screenName = existing ? existing.screenName : body.screenName;
      if (!existing) {
        if (!/^[A-Za-z0-9_.-]{3,16}$/.test(screenName || "")) return res.status(400).json({ error: "bad_name" });
        const lower = screenName.toLowerCase();
        const claimed = await redis("HSETNX", NAMES, lower, id);
        if (!claimed && (await redis("HGET", NAMES, lower)) !== id) return res.status(409).json({ error: "name_taken" });
      }
      const best = Math.max(score, existing ? existing.best : 0);
      await redis("HSET", PLAYERS, id, JSON.stringify({ screenName, best, key: hash(secret) }));
      return res.status(200).json({ screenName, best });
    }

    if (req.method === "DELETE") {
      if (existing) {
        await redis("HDEL", PLAYERS, id);
        await redis("HDEL", NAMES, existing.screenName.toLowerCase());
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    return res.status(502).json({ error: "store_unavailable" });
  }
};
