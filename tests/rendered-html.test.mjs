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

test("uses fixed password accounts with secure server-side sessions", async () => {
  const [auth, store, loginRoute, logoutRoute, quoteTool, migration] = await Promise.all([
    readFile(new URL("lib/server/auth.ts", root), "utf8"),
    readFile(new URL("lib/server/store.ts", root), "utf8"),
    readFile(new URL("app/api/login/route.ts", root), "utf8"),
    readFile(new URL("app/api/logout/route.ts", root), "utf8"),
    readFile(new URL("app/QuoteTool.tsx", root), "utf8"),
    readFile(new URL("drizzle/0005_worried_mole_man.sql", root), "utf8"),
  ]);

  assert.match(auth, /username: "sam"[\s\S]*role: "user"/);
  assert.match(auth, /username: "ruihan"[\s\S]*role: "user"/);
  assert.match(auth, /username: "hogan"[\s\S]*role: "admin"/);
  assert.match(auth, /username: "admin"[\s\S]*role: "admin"/);
  assert.match(auth, /PBKDF2_ITERATIONS = 100_000/);
  assert.match(auth, /e3-quoter-session/);
  assert.match(auth, /httpOnly:\s*true/);
  assert.match(auth, /MAX_LOGIN_FAILURES = 5/);
  assert.match(store, /Authentication required/);
  assert.match(loginRoute, /loginWithPassword/);
  assert.match(logoutRoute, /logoutCurrentSession/);
  assert.match(quoteTool, /Sign in to continue/);
  assert.match(migration, /CREATE TABLE `auth_sessions`/);
  assert.match(migration, /CREATE TABLE `login_attempts`/);
  assert.doesNotMatch(auth, /password:\s*["']/i);
});
