import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("builds the production Cloudflare bindings", async () => {
  const generated = JSON.parse(
    await readFile(new URL("dist/server/wrangler.json", root), "utf8"),
  );

  assert.equal(generated.name, "quoter-helper");
  assert.deepEqual(generated.assets, {
    binding: "ASSETS",
    directory: "../client",
  });
  assert.deepEqual(generated.images, { binding: "IMAGES" });
  assert.deepEqual(generated.d1_databases, [
    {
      binding: "DB",
      database_name: "e3-quoter-db",
      database_id: "ef517acd-0992-4053-909c-2a1127231029",
      migrations_dir: "drizzle",
    },
  ]);
});

test("supports public visitor sessions and a runtime-only administrator secret", async () => {
  const [auth, store, adminRoute, quoteTool, readme] = await Promise.all([
    readFile(new URL("app/chatgpt-auth.ts", root), "utf8"),
    readFile(new URL("lib/server/store.ts", root), "utf8"),
    readFile(new URL("app/api/admin-access/route.ts", root), "utf8"),
    readFile(new URL("app/QuoteTool.tsx", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
  ]);

  assert.match(auth, /cf-access-authenticated-user-email/);
  assert.match(auth, /e3-quoter-visitor/);
  assert.match(auth, /httpOnly:\s*true/);
  assert.match(store, /canBootstrapAdmin:\s*false/);
  assert.match(adminRoute, /env[\s\S]*ADMIN_PASSWORD/);
  assert.match(adminRoute, /crypto\.subtle\.digest/);
  assert.match(quoteTool, /Administrator access/);
  assert.doesNotMatch(`${auth}\n${store}\n${adminRoute}\n${quoteTool}\n${readme}`, /e3123/i);
});
