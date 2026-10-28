import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
const assets = (await readdir("dist/assets")).filter((name) =>
  name.endsWith(".js"),
);
const sizes = await Promise.all(
  assets.map(async (name) => ({
    name,
    data: await readFile("dist/assets/" + name),
  })),
);
const target = sizes.sort((a, b) => b.data.length - a.data.length)[0];
assert(
  target.data.length > 100_000,
  "exercise a large bundled JavaScript mismatch",
);
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = resolve("dist", "." + pathname);
    assert(file.startsWith(resolve("dist") + "/"));
    const data = await readFile(file);
    if (pathname === "/assets/" + target.name) data[0] ^= 1;
    response.writeHead(200).end(data);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=128", "tools/verify-live.mjs"],
      {
        env: {
          ...process.env,
          LIVE_URL: `http://127.0.0.1:${server.address().port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(Error("Mismatch must fail promptly"));
    }, 10000);
    const collect = (chunk) => {
      output += chunk;
      if (output.length > 10000) {
        child.kill("SIGKILL");
        reject(Error("Unbounded verifier diagnostics"));
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
  assert.equal(result.code, 1);
  assert(
    result.output.includes(`Published dist/assets/${target.name} differs:`),
  );
  assert(result.output.length < 4096);
  console.log(
    `PASS large (${target.data.length} byte) mismatched bundle fails with bounded diagnostics under a 128 MB JavaScript heap`,
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
