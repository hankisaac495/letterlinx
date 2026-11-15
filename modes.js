// Game versions. Loaded by the page (window.LLX_MODES) and by the API (require).
// To add a version, add an entry here: the grid, timer, scoring and leaderboard all follow it.
(function (root) {
  var modes = {
    classic: {
      name: "Classic",
      cols: 6, rows: 10,     // grid size
      seconds: 60,           // round length
      tickFrom: 10,          // ticking sound for the last N seconds
      minLength: 2,          // shortest word that counts
      // points[n] = score for an n-letter word; longer words use the last entry
      points: [0, 0, 1, 3, 5, 10, 15, 25, 35, 50]
    }
  };
  var api = {
    modes: modes,
    defaultMode: "classic",
    pointsFor: function (mode, len) {
      var p = (modes[mode] || modes.classic).points;
      return len >= p.length ? p[p.length - 1] : p[len] || 0;
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LLX_MODES = api;
})(typeof window !== "undefined" ? window : this);
