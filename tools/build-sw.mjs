import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
async function files(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === "sw.js" || e.name === "_headers") continue;
    const path = dir + "/" + e.name;
    if (e.isDirectory()) out.push(...(await files(path)));
    else out.push(path);
  }
  return out;
}
const assets = await files("dist");
const hash = createHash("sha256");
const fingerprints = {};
const worker = await readFile("tools/service-worker.js", "utf8");
for (const path of assets.sort()) {
  const data = await readFile(path);
  if (data.length > 25 * 1024 * 1024)
    throw Error(path + " exceeds Cloudflare Pages size limit");
  fingerprints["/" + path.slice(5)] = createHash("sha256")
    .update(data)
    .digest("hex");
  hash.update(path);
  hash.update(data);
}
hash.update(await readFile("tools/build-sw.mjs"));
hash.update(worker);
const version = hash.digest("hex").slice(0, 14);
const urls = assets.map((p) => "/" + p.slice(5));
await writeFile(
  "dist/sw.js",
  `
const CACHE='blocks-${version}';
const ASSETS=${JSON.stringify(urls)};
const HASHES=${JSON.stringify(fingerprints)};
${worker}
`,
);
await writeFile(
  "dist/_headers",
  "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Cache-Control: public, max-age=0, must-revalidate\n/sw.js\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n",
);
console.log("Offline build", version, urls.length, "assets");
