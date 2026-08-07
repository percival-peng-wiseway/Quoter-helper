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
  assert.match(quotesRoute, /Need a Customer Name/);
  assert.match(store, /Need a Customer Name/);
  assert.match(quoteTool, /flash\("Need a Customer Name"\)/);
  assert.match(quoteTool, /id="customer-name" required/);
  assert.match(migration, /CREATE TABLE `auth_sessions`/);
  assert.match(migration, /CREATE TABLE `login_attempts`/);
  assert.doesNotMatch(auth, /password:\s*["']/i);
});

test("adds VIC funding and deducts discount from total received and margins", async () => {
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
  assert.ok(Math.abs((after.totalReceivedExGst - before.totalReceivedExGst) - 25) < 1e-9);
  assert.ok(Math.abs((after.grossMargin - before.grossMargin) - 25) < 1e-9);
  assert.ok(after.grossMarginRate > before.grossMarginRate);
  assert.ok(after.targetRequiredBalance < before.targetRequiredBalance);
  assert.equal(legacyNegativeDiscount.grossMargin, after.grossMargin);

  const funded = calculateQuote({
    ...inputs,
    customerBalance: 110,
    solarVicRebate: 30,
    solarVicLoan: 40,
    discount: 5,
    batteryKwh: 1,
  }, {
    ...settings,
    solarStcUnitPrice: 10,
    batteryStcUnitPrice: 20,
    stcScaleFactor: 1,
    stcYears: 1,
    batteries: [{ name: "Test battery", kwh: 1, certificates: 5, cost: 0 }],
  });
  assert.equal(funded.solarStc, 10);
  assert.equal(funded.batteryStc, 100);
  assert.equal(funded.totalReceivedExGst, 275);
});

test("supports per-quote C&I margins and manual STC funding", async () => {
  const { calculateQuote } = await loadTypeScriptModule("lib/calculate.ts");
  const settings = {
    thresholds: { approval: 0.1, target: 0.2 },
    gstRate: 0.1,
    solarStcUnitPrice: 10,
    batteryStcUnitPrice: 20,
    stcScaleFactor: 1,
    stcYears: 1,
    panelBatchWatts: 1000,
    panelBatchCost: 100,
    accessoryCostPerKw: 0,
    solarInstallCostPerKw: 0,
    batteryInstallCost: 0,
    deliveryCost: 0,
    blinkFee: 0,
    margins: { solarPanel: 0.2 },
    inverters: [],
    batteries: [{ name: "Test battery", kwh: 1, certificates: 5, cost: 0 }],
  };
  const inputs = {
    ...defaultQuoteForPvSizeTest(),
    mode: "ci",
    pvSize: 1,
    batteryKwh: 1,
    customerBalance: 110,
    manualSolarStc: 300,
    manualBatteryStc: 400,
    manualMargins: { solarPanel: 0.5, inverter: 0.4 },
  };

  const ci = calculateQuote(inputs, settings);
  const residential = calculateQuote({ ...inputs, mode: "residential" }, settings);
  const ciSolarPanel = ci.lineItems.find((item) => item.key === "solarPanel");
  const residentialSolarPanel = residential.lineItems.find((item) => item.key === "solarPanel");

  assert.equal(ci.solarStc, 300);
  assert.equal(ci.batteryStc, 400);
  assert.equal(ciSolarPanel.margin, 0.5);
  assert.equal(ciSolarPanel.salesPrice, 150);
  assert.equal(residential.solarStc, 10);
  assert.equal(residential.batteryStc, 100);
  assert.equal(residentialSolarPanel.margin, 0.2);
  assert.equal(residentialSolarPanel.salesPrice, 120);

  const [quoteTool, model, defaults] = await Promise.all([
    readFile(new URL("app/QuoteTool.tsx", root), "utf8"),
    readFile(new URL("lib/model.ts", root), "utf8"),
    readFile(new URL("lib/defaults.ts", root), "utf8"),
  ]);
  assert.match(model, /QuoteMode = "residential" \| "ci"/);
  assert.match(defaults, /mode: "residential"/);
  assert.match(quoteTool, /aria-label="Quote mode"/);
  assert.match(quoteTool, /setManualMargin\(item\.key/);
  assert.match(quoteTool, /manualSolarStc/);
  assert.match(quoteTool, /manualBatteryStc/);
  assert.match(quoteTool, /!isCiMode && <div className="quick-margin-buttons funding-quick-margins">/);
  assert.match(quoteTool, /quote\.payload\.mode === "ci"/);
  assert.match(quoteTool, /className="ci-badge"/);
  assert.doesNotMatch(quoteTool, /quote-total-chips/);
  assert.doesNotMatch(quoteTool, />Total cost</);
  assert.doesNotMatch(quoteTool, />Total sales price</);
  assert.doesNotMatch(quoteTool, /className="target-card"/);
  assert.doesNotMatch(quoteTool, />Shortfall</);
});

test("uses editable per-kW base rates without exposing formulas in the calculator", async () => {
  const { defaultSettings, normalizeSettings } = await loadTypeScriptModule("lib/defaults.ts");
  const { updatePvSize } = await loadTypeScriptModule("lib/quote-inputs.ts");
  const legacySettings = { ...defaultSettings, solarInstallCostPerWatt: 0.3 };
  delete legacySettings.solarInstallCostPerKw;
  const normalized = normalizeSettings(legacySettings);
  assert.equal(normalized.accessoryCostPerKw, 95);
  assert.equal(normalized.solarInstallCostPerKw, 300);
  assert.equal("solarInstallCostPerWatt" in normalized, false);

  const resized = updatePvSize({
    ...defaultQuoteForPvSizeTest(),
    pvSize: 6.6,
    manualCosts: { ...defaultQuoteForPvSizeTest().manualCosts, accessories: 500, solarInstallation: 1200 },
  }, 10);
  assert.equal(resized.pvSize, 10);
  assert.equal(resized.manualCosts.accessories, undefined);
  assert.equal(resized.manualCosts.solarInstallation, undefined);

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
  assert.match(quoteTool, /onChange=\{setPvSize\}/);
  assert.match(quoteTool, /quote-cost-column/);
  assert.match(quoteTool, /customer-balance-summary/);
  assert.match(quoteTool, /Customer balance <small>\(incl\. GST\)<\/small>/);
});

function defaultQuoteForPvSizeTest() {
  return {
    date: "2026-08-06",
    customerName: "PV size test",
    phone: "",
    address: "",
    pvSize: 0,
    batteryKwh: 0,
    inverter: "",
    initiator: "",
    customerBalance: 0,
    solarVicRebate: 0,
    solarVicLoan: 0,
    discount: 0,
    customItems: [],
    manualCosts: { backup: 0, acCable: 0, switchboard: 0, subSwitchboard: 0, externalCommission: 0 },
  };
}
