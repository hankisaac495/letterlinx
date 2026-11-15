// Game versions. Loaded by the page (window.LLX_MODES) and by the API (require).
// To add a version, add an entry here: the grid, timer, scoring and leaderboard all follow it.
(function (root) {
  var grid = { cols: 6, rows: 10 };                          // grid size
  var points = [0, 0, 1, 3, 5, 10, 15, 25, 35, 50];           // points[n] = score for an n-letter word; longer words use the last entry
  var modes = {
    // The key is what the database stores for each round, so don't rename one that has been played.
    classic: {
      name: "English", lang: "en",
      cols: grid.cols, rows: grid.rows,
      seconds: 60,           // round length
      tickFrom: 10,          // ticking sound for the last N seconds
      minLength: 2,          // shortest word that counts
      points: points,
      dict: { file: "words.js", global: "LLX_WORDS" },        // word list file and the variable it sets
      alphabet: "abcdefghijklmnopqrstuvwxyz",
      // how often each letter is dealt (relative weights)
      letters: { E: 12, A: 9, I: 8, O: 8, U: 4, S: 7, T: 7, N: 6, R: 6, C: 4, H: 4, M: 4, P: 4, L: 4, D: 4,
        G: 3, B: 2, F: 2, Y: 2, W: 2, K: 1.5, V: 1, X: 0.5, J: 0.5, Z: 0.5, Q: 0.3 }
    },
    es: {
      name: "Español", lang: "es",
      cols: grid.cols, rows: grid.rows,
      seconds: 60, tickFrom: 10, minLength: 2,
      points: points,
      dict: { file: "words-es.js", global: "LLX_WORDS_ES" },
      alphabet: "abcdefghijklmnopqrstuvwxyzñ",              // accents are not used; Ñ is its own letter
      letters: { A: 15, E: 12, O: 8, I: 7.5, U: 3.5, S: 8, R: 7.5, N: 6, L: 4.5, C: 4.5, T: 4.5, D: 4, M: 3.5,
        P: 2.5, B: 2.3, G: 1.5, H: 1, F: 1, V: 1, Z: 0.8, J: 0.6, Q: 0.4, Y: 0.4, "\u00d1": 0.4, X: 0.15 }
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
