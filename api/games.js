// POST /api/games  { mode, words, at }  -> saves one finished round for the signed-in player
const L = require("./_lib.js");

module.exports = L.route(async (req, res, p) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const player = await L.currentPlayer(req, p);
  if (!player) return res.status(401).json({ error: "signed_out" });
  await L.saveGames(p, player.id, [L.body(req)]);
  return res.status(200).json(await L.profile(p, player));
});
