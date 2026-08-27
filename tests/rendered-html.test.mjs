import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);
const PORT = 3100;
const BASE = `http://localhost:${PORT}`;

async function waitForServer(proc) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`next start exited early with code ${proc.exitCode}`);
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
      if (res.ok || res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("next start did not become ready in time");
}

test("server-renders the Goocart application shell and role split is correct", async (t) => {
  // shell:true is required for npx to resolve on Windows (npx.cmd); every
  // argument here is a fixed literal, not external input, so this is safe.
  const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
    cwd: new URL(".", root),
    shell: true,
    stdio: "ignore",
  });
  t.after(() => {
    // On Windows, spawning with shell:true means server.pid is the shell's
    // pid, not npx/next's — plain .kill() leaves the real server running.
    // taskkill with /t kills the whole process tree.
    if (process.platform === "win32") {
      try {
        execFileSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
      } catch {
        // already exited
      }
    } else {
      server.kill();
    }
  });

  await waitForServer(server);

  const response = await fetch(BASE, { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Goocart/i);

  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  // Vendor and Delivery Partner are native apps now, not roles rendered by
  // the web portal — only Customer and Admin remain here.
  assert.doesNotMatch(page, /<Vendor\b/);
  assert.doesNotMatch(page, /<Partner\b/);
  assert.match(page, /state\.actor\.role==="CUSTOMER"/);
  assert.match(page, /AdminVendors/);
});
