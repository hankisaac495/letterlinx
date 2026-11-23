// The English dictionary: well formed, and includes the words added on request (see README).
const test = require("node:test"), assert = require("node:assert");
global.window = global.window || {}; require("../words.js");
const list = window.LLX_WORDS.split("|"), words = new Set(list);

test("words added on request are in the English dictionary", () => {
  for (const w of ["indian", "indians"]) assert.ok(words.has(w), w);
});

test("the English dictionary is lowercase, sorted and has no duplicates", () => {
  assert.ok(list.length > 270000);
  assert.ok(list.every((w) => /^[a-z]+$/.test(w)));
  assert.strictEqual(words.size, list.length);
  for (let i = 1; i < list.length; i++) if (list[i - 1] >= list[i]) assert.fail("out of order at " + list[i]);
});
