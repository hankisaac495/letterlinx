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
  // Daily games: everyone gets the same letters on the same calendar day. Game `first` is played on `start`.
  var daily = { start: "2026-11-16", first: 101 };
  function dayNumber(y, mo, d) {
    var s = daily.start.split("-");
    return Math.max(daily.first, daily.first + Math.round((Date.UTC(y, mo, d) - Date.UTC(+s[0], s[1] - 1, +s[2])) / 86400000));
  }
  // repeatable random numbers from a text seed, identical on every device
  function seedOf(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function rng(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var api = {
    modes: modes,
    defaultMode: "classic",
    daily: daily,
    // game number for a device's local calendar date, and for a moment in UTC (used by the server as a sanity check)
    gameNumber: function (date) { return dayNumber(date.getFullYear(), date.getMonth(), date.getDate()); },
    gameNumberUTC: function (ms) { var d = new Date(ms); return dayNumber(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); },
    // the endless letter sequence for one column of one day's game: the first letters fill the column from the
    // top down, the rest arrive in order as tiles are used
    letterStream: function (mode, game, col) {
      var bag = modes[mode].letters, keys = Object.keys(bag), total = 0, next = rng(seedOf(mode + ":" + game + ":" + col));
      for (var i = 0; i < keys.length; i++) total += bag[keys[i]];
      return function () {
        var x = next() * total;
        for (var k = 0; k < keys.length; k++) { x -= bag[keys[k]]; if (x < 0) return keys[k]; }
        return keys[0];
      };
    },
    pointsFor: function (mode, len) {
      var p = (modes[mode] || modes.classic).points;
      return len >= p.length ? p[p.length - 1] : p[len] || 0;
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LLX_MODES = api;
})(typeof window !== "undefined" ? window : this);
