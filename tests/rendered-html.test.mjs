import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  const nextCli = fileURLToPath(new URL("node_modules/next/dist/bin/next", root));
  const server = spawn(process.execPath, [nextCli, "start", "-p", String(PORT)], {
    cwd: fileURLToPath(root),
    stdio: "ignore",
  });
  t.after(() => {
    // taskkill with /t also stops any worker child processes Next started.
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
  // Customer, Vendor and Delivery Partner are all native apps now — this web
  // app is the Admin console only.
  assert.doesNotMatch(page, /<Vendor\b/);
  assert.doesNotMatch(page, /<Partner\b/);
  assert.doesNotMatch(page, /<Customer\b/);
  assert.match(page, /state\.actor\.role\.includes\("ADMIN"\)/);
  assert.match(page, /AdminVendors/);
});
