// The generated pages: WordFinder share-link pages carry their own title, preview image and canonical address.
const test = require("node:test"), assert = require("node:assert"), fs = require("fs"), path = require("path");
const W = require("../wordfinder.js");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("WordFinder pages have their own link preview in each language", () => {
  for (const [file, lang, url, img] of [
    ["wordfinder/index.html", "en", "https://www.letterlinx.com/wordfinder/", "og-wordfinder.png"],
    ["es/wordfinder/index.html", "es", "https://www.letterlinx.com/es/wordfinder/", "og-wordfinder-es.png"],
  ]) {
    const html = read(file);
    assert.match(html, new RegExp(`<html lang="${lang}">`));
    assert.match(html, /<base href="\/">/);
    assert.match(html, /<title>Linx WordFinder/);
    assert.ok(html.includes(`<link rel="canonical" href="${url}">`), file + " canonical");
    assert.ok(html.includes(`<meta property="og:image" content="https://www.letterlinx.com/${img}">`), file + " image");
    assert.ok(fs.existsSync(path.join(__dirname, "..", img)), img + " exists");
  }
  assert.match(read("index.html"), /og-image\.png/);              // the main page keeps its own preview
});

test("the WordFinder share links redirect to the pages", () => {
  const v = JSON.parse(read("vercel.json"));
  for (const src of ["/wordfinder", "/es/wordfinder"]) assert.ok(v.redirects.some((r) => r.source === src && r.destination === src + "/"));
});

test("the sample answers are never part of the public site", () => {
  assert.ok(!fs.existsSync(path.join(__dirname, "..", "wordfinder-samples.js")));
  for (const f of ["index.html", "wordfinder/index.html"]) assert.ok(!read(f).includes("_wf_samples"));
});

test("puzzle numbers follow the calendar from launch", () => {
  assert.strictEqual(W.numberOf(W.LAUNCH), 1);
  assert.strictEqual(W.dayOf(1), W.LAUNCH);
  for (const n of [1, 2, 31, 142, 400]) assert.strictEqual(W.numberOf(W.dayOf(n)), n);
});
