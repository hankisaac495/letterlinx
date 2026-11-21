// Fills the search-engine tags in index.html and generates the Spanish page es/index.html.
// Run after changing index.html or i18n.js:  npm run pages
const fs = require("fs"), path = require("path");
global.window = {}; require("./i18n.js");
const T = window.LLX_I18N, SITE = "https://www.letterlinx.com";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// wf: the Linx WordFinder pages (/wordfinder/ and /es/wordfinder/), which open straight into that game
function head(lang, wf) {
  const t = (k) => T[lang][k], base = lang === "es" ? "/es/" : "/", url = SITE + base + (wf ? "wordfinder/" : "");
  const title = wf ? t("wf.pageTitle") : t("app.title"), desc = wf ? t("wf.pageDesc") : t("app.description");
  const image = SITE + (wf ? (lang === "es" ? "/og-wordfinder-es.png" : "/og-wordfinder.png") : "/og-image.png");
  const alt = (l) => SITE + (l === "es" ? "/es/" : "/") + (wf ? "wordfinder/" : "");
  const data = wf ? { "@context": "https://schema.org", "@type": ["VideoGame", "WebApplication"], name: "Linx WordFinder", url,
      description: desc, image, applicationCategory: "GameApplication", genre: "Word game", operatingSystem: "Any",
      browserRequirements: "Requires JavaScript", inLanguage: lang, playMode: "SinglePlayer", isAccessibleForFree: true,
      isPartOf: { "@type": "WebSite", name: t("app.name"), url: SITE + base }, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } }
    : { "@context": "https://schema.org", "@graph": [
    { "@type": ["VideoGame", "WebApplication"], name: t("app.name"), alternateName: lang === "es" ? "LetterLinx" : "Letra Linx", url,
      description: t("app.description"), image: SITE + "/og-image.png", applicationCategory: "GameApplication", genre: "Word game",
      operatingSystem: "Any", browserRequirements: "Requires JavaScript", inLanguage: ["en", "es"], playMode: "SinglePlayer",
      isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
    { "@type": "FAQPage", inLanguage: lang, mainEntity: [1, 5, 2, 3, 4].map((n) => (
      { "@type": "Question", name: t("faq.q" + n), acceptedAnswer: { "@type": "Answer", text: t("faq.a" + n) } })) },
  ] };
  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="canonical" href="${url}">`,
    `<link rel="alternate" hreflang="en" href="${alt("en")}">`,
    `<link rel="alternate" hreflang="es" href="${alt("es")}">`,
    `<link rel="alternate" hreflang="x-default" href="${alt("en")}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(t("app.name"))}">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:locale" content="${lang === "es" ? "es_ES" : "en_US"}">`,
    `<meta property="og:locale:alternate" content="${lang === "es" ? "en_US" : "es_ES"}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image" content="${image}">`,
    `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`,
  ].join("\n");
}

// put a language's text into every element marked data-t="key", and its head tags between the seo markers
function page(html, lang, wf) {
  html = html.replace(/(<!-- seo:start[^>]*-->\n)[\s\S]*?(<!-- seo:end -->)/, (m, a, b) => a + head(lang, wf) + "\n" + b);
  html = html.replace(/(data-t="([^"]+)"[^>]*>)([^<]*)/g, (m, open, key) => open + esc(T[lang][key] ?? T.en[key] ?? ""));
  html = html.replace(/(<p id="tourDrag">)[^<]*/, (m, open) => open + esc(T[lang]["tour.dragText"].replace("{n}", 2)));
  html = html.replace(/(data-t-label="([^"]+)"[^>]*?aria-label=")[^"]*/g, (m, open, key) => open + esc(T[lang][key] ?? ""));
  return html;
}

const src = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const en = page(src, "en");
fs.writeFileSync(path.join(__dirname, "index.html"), en);
const es = page(en, "es")
  .replace('<html lang="en">', '<html lang="es">')
  .replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="/">')
  .replace('content="LetterLinx">', 'content="Letra Linx">');
const generated = (html) => html.replace(/^<!doctype html>\n/i, "<!doctype html>\n<!-- Generated from index.html by build-pages.js. Do not edit; run: npm run pages -->\n");
const write = (dir, html) => { fs.mkdirSync(path.join(__dirname, dir), { recursive: true }); fs.writeFileSync(path.join(__dirname, dir, "index.html"), generated(html)); };
write("es", es);
// the WordFinder pages: same app, their own title, description and link preview; files load from the site root
write("wordfinder", page(en, "en", true).replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<base href="/">'));
write("es/wordfinder", page(es, "es", true));
console.log("index.html, es/index.html, wordfinder/index.html and es/wordfinder/index.html updated");
