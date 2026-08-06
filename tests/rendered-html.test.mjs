import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);

async function loadTypeScriptModule(path) {
  const source = await readFile(new URL(path, root), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
  return import(moduleUrl);
}

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
  const [auth, store, loginRoute, logoutRoute, quotesRoute, quoteDeleteRoute, quoteTool, migration] = await Promise.all([
    readFile(new URL("lib/server/auth.ts", root), "utf8"),
    readFile(new URL("lib/server/store.ts", root), "utf8"),
    readFile(new URL("app/api/login/route.ts", root), "utf8"),
    readFile(new URL("app/api/logout/route.ts", root), "utf8"),
    readFile(new URL("app/api/quotes/route.ts", root), "utf8"),
    readFile(new URL("app/api/quotes/delete/route.ts", root), "utf8"),
    readFile(new URL("app/QuoteTool.tsx", root), "utf8"),
    readFile(new URL("drizzle/0005_worried_mole_man.sql", root), "utf8"),
  ]);

  assert.match(auth, /username: "sam"[\s\S]*role: "user"/);
  assert.match(auth, /username: "ruihan"[\s\S]*role: "user"/);
  assert.match(auth, /username: "kevin"[\s\S]*role: "user"/);
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
  assert.match(quoteTool, /Team quotes/);
  assert.match(store, /export async function listQuotes\(\)/);
  assert.doesNotMatch(store, /FROM quotes WHERE owner_id = \?/);
  assert.match(store, /export async function deleteQuote[\s\S]*viewer\.role !== "admin"/);
  assert.match(quotesRoute, /export async function DELETE/);
  assert.match(quotesRoute, /deleteQuote\(viewer, body\.id\)/);
  assert.match(quoteDeleteRoute, /export async function POST/);
  assert.match(quoteDeleteRoute, /deleteQuote\(viewer, body\.id\)/);
  assert.match(migration, /CREATE TABLE `auth_sessions`/);
  assert.match(migration, /CREATE TABLE `login_attempts`/);
  assert.doesNotMatch(auth, /password:\s*["']/i);
});

test("deducts VIC rebate, VIC loan and discount from totals and margins", async () => {
  const { calculateQuote } = await loadTypeScriptModule("lib/calculate.ts");
  const settings = {
    thresholds: { approval: 0.22, target: 0.25 },
    gstRate: 0.1,
    solarStcUnitPrice: 0,
    batteryStcUnitPrice: 0,
    stcScaleFactor: 0,
    stcYears: 0,
    panelBatchWatts: 1000,
    panelBatchCost: 100,
    accessoryCostPerKw: 0,
    solarInstallCostPerKw: 0,
    batteryInstallCost: 0,
    deliveryCost: 0,
    blinkFee: 0,
    margins: { solarPanel: 0.2 },
    inverters: [],
    batteries: [],
  };
  const inputs = {
    date: "2026-08-06",
    customerName: "Calculation test",
    phone: "",
    address: "",
    pvSize: 1,
    batteryKwh: 0,
    inverter: "",
    initiator: "",
    customerBalance: 132,
    solarVicRebate: 0,
    solarVicLoan: 0,
    discount: 0,
    customItems: [],
    manualCosts: { backup: 0, batteryInstallation: 0, acCable: 0, switchboard: 0, subSwitchboard: 0, externalCommission: 0 },
  };

  const before = calculateQuote(inputs, settings);
  const after = calculateQuote({ ...inputs, solarVicRebate: 10, solarVicLoan: 20, discount: 5 }, settings);
  const legacyNegativeDiscount = calculateQuote({ ...inputs, solarVicRebate: 10, solarVicLoan: 20, discount: -5 }, settings);

  assert.equal(before.lineItemCostTotal - after.lineItemCostTotal, 35);
  assert.equal(before.lineItemSalesTotal - after.lineItemSalesTotal, 35);
  assert.equal(before.quoteRequiredBalance - after.quoteRequiredBalance, 35);
  assert.equal(before.totalReceivedExGst - after.totalReceivedExGst, 35);
  assert.equal(before.grossMargin - after.grossMargin, 35);
  assert.ok(after.grossMarginRate < before.grossMarginRate);
  assert.ok(after.targetRequiredBalance > before.targetRequiredBalance);
  assert.equal(legacyNegativeDiscount.grossMargin, after.grossMargin);
});

test("uses editable per-kW base rates without exposing formulas in the calculator", async () => {
  const { defaultSettings, normalizeSettings } = await loadTypeScriptModule("lib/defaults.ts");
  const legacySettings = { ...defaultSettings, solarInstallCostPerWatt: 0.3 };
  delete legacySettings.solarInstallCostPerKw;
  const normalized = normalizeSettings(legacySettings);
  assert.equal(normalized.accessoryCostPerKw, 95);
  assert.equal(normalized.solarInstallCostPerKw, 300);
  assert.equal("solarInstallCostPerWatt" in normalized, false);

  const [calculate, quoteTool] = await Promise.all([
    readFile(new URL("lib/calculate.ts", root), "utf8"),
    readFile(new URL("app/QuoteTool.tsx", root), "utf8"),
  ]);
  assert.match(calculate, /pvSize \* settings\.accessoryCostPerKw/);
  assert.match(calculate, /pvSize \* settings\.solarInstallCostPerKw/);
  assert.doesNotMatch(calculate, /PV system size · editable/);
  assert.match(quoteTool, /Accessories unit cost/);
  assert.match(quoteTool, /Solar installation unit cost/);
  assert.match(quoteTool, /\/ PV system kW/);
  assert.match(quoteTool, /customer-balance-summary/);
  assert.match(quoteTool, /Customer balance <small>\(incl\. GST\)<\/small>/);
});
