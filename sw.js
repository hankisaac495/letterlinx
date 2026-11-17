// LetterLinx service worker. It exists so phones treat the game as an installable app.
// It caches nothing: every request goes to the network as normal, so players always get the latest version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
