import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Goocart application shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Goocart — Everything local, one app<\/title>/i);
  assert.match(html, /Starting Goocart/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/i);
});

test("vendor and delivery apps are role-routed with complete lifecycle actions", async () => {
  const [page, proxy, portal, migration] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/[...path]/route.ts", root), "utf8"),
    readFile(new URL("server/src/routes/portal.ts", root), "utf8"),
    readFile(new URL("scripts/migrate-d1-to-mongodb.py", root), "utf8"),
  ]);

  assert.match(page, /state\.actor\.role==="DELIVERY_PARTNER"\?<Partner/);
  assert.match(page, /\["VENDOR_OWNER","VENDOR_MANAGER"\]\.includes\(state\.actor\.role\)\?<Vendor/);
  assert.match(page, /Receive[\s\S]*Accept[\s\S]*Prepare[\s\S]*Hand off[\s\S]*Get paid/);
  assert.match(page, /Go online[\s\S]*Accept[\s\S]*Navigate[\s\S]*Verify[\s\S]*Earn/);
  assert.match(page, /Customer verification PIN/);
  assert.match(proxy, /GOOCART_API_URL/);
  assert.match(portal, /ACTIVE_TASK_EXISTS/);
  assert.match(portal, /INVALID_VERIFICATION_CODE/);
  assert.match(portal, /VENDOR_CLOSED/);
  assert.match(portal, /offer\.create/);
  assert.match(migration, /vendor_offers/);
});
