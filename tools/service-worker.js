// CACHE, ASSETS and HASHES are supplied by build-sw.mjs.
const HASH_HEADER = "X-Blocks-Content-Hash";

async function install() {
  const cache = await caches.open(CACHE);
  const previous = await Promise.all(
    (await caches.keys())
      .filter((key) => key.startsWith("blocks-") && key !== CACHE)
      .reverse()
      .map((key) => caches.open(key)),
  );
  async function cacheAsset(url) {
    for (const old of previous) {
      const response = await old.match(url);
      if (!response) continue;
      if (response.headers.get(HASH_HEADER) === HASHES[url]) {
        await cache.put(url, response);
        return;
      }
      // One-time migration from releases without fingerprints. Verify the bytes
      // before trusting a stable URL, when stable asset paths change.
      if (!response.headers.has(HASH_HEADER)) {
        const data = await response.arrayBuffer();
        const digest = await crypto.subtle.digest("SHA-256", data);
        const actual = [...new Uint8Array(digest)]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        if (actual === HASHES[url]) {
          const headers = new Headers(response.headers);
          headers.set(HASH_HEADER, actual);
          headers.delete("Content-Encoding");
          headers.set("Content-Length", String(data.byteLength));
          await cache.put(url, new Response(data, { headers }));
          return;
        }
      }
    }
    const response = await fetch(new Request(url, { cache: "reload" }));
    if (!response.ok) throw Error(url);
    const data = await response.blob(),
      headers = new Headers(response.headers);
    headers.delete("Content-Encoding");
    headers.set("Content-Length", String(data.size));
    headers.set(HASH_HEADER, HASHES[url]);
    await cache.put(url, new Response(data, { headers }));
  }
  try {
    // Bound installation memory and CPU while fetching assets.
    let next = 0;
    await Promise.all(
      Array.from({ length: 2 }, async () => {
        while (next < ASSETS.length) await cacheAsset(ASSETS[next++]);
      }),
    );
    if (!self.registration.active) await self.skipWaiting();
  } catch (error) {
    await caches.delete(CACHE);
    throw error;
  }
}
self.addEventListener("install", (event) => event.waitUntil(install()));
async function pruneCaches() {
  const windows = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  if (windows.length > 1) return;
  for (const key of await caches.keys()) {
    if (key.startsWith("blocks-") && key !== CACHE) await caches.delete(key);
  }
}
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      await pruneCaches();
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data === "activate") self.skipWaiting();
  if (event.data === "status") event.source?.postMessage("offline-ready");
});
self.addEventListener("fetch", (event) => {
  if (
    event.request.method !== "GET" ||
    new URL(event.request.url).origin !== self.location.origin
  )
    return;
  if (event.request.mode === "navigate") event.waitUntil(pruneCaches());
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE),
        url = new URL(event.request.url);
      const cached = await cache.match(
        url.pathname === "/" || event.request.mode === "navigate"
          ? "/index.html"
          : url.pathname,
      );
      if (!cached)
        return (await caches.match(event.request)) || fetch(event.request);
      return cached;
    })(),
  );
});
