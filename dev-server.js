// Local stand-in for Vercel: serves the static files and runs the functions in api/.
// Usage: DATABASE_URL=postgres://... npm run dev
const http = require("http"), fs = require("fs"), path = require("path");
const PORT = process.env.PORT || 3000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".xml": "application/xml", ".txt": "text/plain; charset=utf-8", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    const file = path.join(__dirname, "api", path.basename(url.pathname) + ".js");
    if (path.basename(file).startsWith("_") || !fs.existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
    let raw = ""; for await (const c of req) raw += c;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch (e) { req.body = {}; }
    req.query = Object.fromEntries(url.searchParams);
    res.status = (s) => { res.statusCode = s; return res; };
    res.json = (j) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(j)); };
    return require(file)(req, res);
  }
  // like the redirects in vercel.json: a folder without its trailing slash goes to the slashed address
  if (!path.extname(url.pathname) && !url.pathname.endsWith("/") && fs.existsSync(path.join(__dirname, url.pathname, "index.html"))) {
    res.statusCode = 308; res.setHeader("location", url.pathname + "/" + url.search); return res.end();
  }
  const rel = path.normalize(url.pathname.endsWith("/") ? url.pathname + "index.html" : url.pathname).replace(/^[/\\]+/, "");
  const file = path.join(__dirname, rel);
  if (!file.startsWith(__dirname) || rel.startsWith("api") || rel.startsWith("node_modules") || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end("not found"); }
  res.setHeader("content-type", TYPES[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log("LetterLinx on http://localhost:" + PORT));
