// Fills the search-engine tags in index.html and generates the Spanish page es/index.html.
// Run after changing index.html or i18n.js:  npm run pages
const fs = require("fs"), path = require("path");
global.window = {}; require("./i18n.js");
const T = window.LLX_I18N, SITE = "https://www.letterlinx.com";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function head(lang) {
  const t = (k) => T[lang][k], url = SITE + (lang === "es" ? "/es/" : "/");
  const data = { "@context": "https://schema.org", "@graph": [
    { "@type": ["VideoGame", "WebApplication"], name: t("app.name"), alternateName: lang === "es" ? "LetterLinx" : "Letra Linx", url,
      description: t("app.description"), image: SITE + "/og-image.png", applicationCategory: "GameApplication", genre: "Word game",
      operatingSystem: "Any", browserRequirements: "Requires JavaScript", inLanguage: ["en", "es"], playMode: "SinglePlayer",
      isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
    { "@type": "FAQPage", inLanguage: lang, mainEntity: [1, 2, 3, 4].map((n) => (
      { "@type": "Question", name: t("faq.q" + n), acceptedAnswer: { "@type": "Answer", text: t("faq.a" + n) } })) },
  ] };
  return [
    `<title>${esc(t("app.title"))}</title>`,
    `<meta name="description" content="${esc(t("app.description"))}">`,
    `<link rel="canonical" href="${url}">`,
    `<link rel="alternate" hreflang="en" href="${SITE}/">`,
    `<link rel="alternate" hreflang="es" href="${SITE}/es/">`,
    `<link rel="alternate" hreflang="x-default" href="${SITE}/">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${esc(t("app.name"))}">`,
    `<meta property="og:title" content="${esc(t("app.title"))}">`,
    `<meta property="og:description" content="${esc(t("app.description"))}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${SITE}/og-image.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:locale" content="${lang === "es" ? "es_ES" : "en_US"}">`,
    `<meta property="og:locale:alternate" content="${lang === "es" ? "en_US" : "es_ES"}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(t("app.title"))}">`,
    `<meta name="twitter:description" content="${esc(t("app.description"))}">`,
    `<meta name="twitter:image" content="${SITE}/og-image.png">`,
    `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`,
  ].join("\n");
}

// put a language's text into every element marked data-t="key", and its head tags between the seo markers
function page(html, lang) {
  html = html.replace(/(<!-- seo:start[^>]*-->\n)[\s\S]*?(<!-- seo:end -->)/, (m, a, b) => a + head(lang) + "\n" + b);
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
fs.mkdirSync(path.join(__dirname, "es"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "es", "index.html"),
  es.replace(/^<!doctype html>\n/i, "<!doctype html>\n<!-- Generated from index.html by build-pages.js. Do not edit; run: npm run pages -->\n"));
console.log("index.html and es/index.html updated");
