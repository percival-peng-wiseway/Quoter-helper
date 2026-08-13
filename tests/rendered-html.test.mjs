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
  assert.match(quoteTool, /quoteCreatedDateLabel\(quote\.createdAt\)/);
  assert.match(quoteTool, /<strong>Initiator:<\/strong>/);
  assert.match(quoteTool, /<strong>Created:<\/strong>/);
  assert.match(quoteTool, /aria-label="Quote filters"/);
  assert.match(quoteTool, /All initiators/);
  assert.match(quoteTool, /All statuses/);
  assert.match(quoteTool, /quote\.status === quoteStatusFilter/);
  assert.match(quoteTool, /setQuoteStatusFilter\(""\)/);
  assert.match(quoteTool, /Created from/);
  assert.match(quoteTool, /Created to/);
  assert.match(quoteTool, /createdDate >= quoteCreatedFrom/);
  assert.match(quoteTool, /createdDate <= quoteCreatedTo/);
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

test("aggregates multiple C&I PV systems, inverter models and battery models", async () => {
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
    accessoryCostPerKw: 10,
    solarInstallCostPerKw: 20,
    batteryInstallCost: 100,
    deliveryCost: 0,
    blinkFee: 0,
    margins: {},
    inverters: [{ name: "INV-A", cost: 100 }, { name: "INV-B", cost: 300 }],
    batteries: [
      { name: "BAT-5", kwh: 5, certificates: 10, cost: 500 },
      { name: "BAT-10", kwh: 10, certificates: 20, cost: 900 },
    ],
  };
  const result = calculateQuote({
    ...defaultQuoteForPvSizeTest(),
    mode: "ci",
    pvSize: 1,
    batteryKwh: 5,
    inverter: "INV-A",
    ciPvSystems: [
      { id: "pv-a", sizeKw: 6.6, quantity: 2 },
      { id: "pv-b", sizeKw: 10, quantity: 1 },
    ],
    ciInverters: [
      { id: "inv-a", model: "INV-A", quantity: 2 },
      { id: "inv-b", model: "INV-B", quantity: 1 },
    ],
    ciBatteries: [
      { id: "bat-a", kwh: 5, quantity: 3 },
      { id: "bat-b", kwh: 10, quantity: 1 },
    ],
  }, settings);

  const cost = (key) => result.lineItems.find((item) => item.key === key).cost;
  assert.ok(Math.abs(result.totalPvSize - 23.2) < 1e-9);
  assert.equal(result.totalBatteryKwh, 25);
  assert.equal(result.solarCertificates, 23);
  assert.equal(result.batteryCertificates, 50);
  assert.equal(cost("solarPanel"), 2400);
  assert.equal(cost("inverter"), 500);
  assert.equal(cost("battery"), 2400);
  assert.ok(Math.abs(cost("accessories") - 232) < 1e-9);
  assert.ok(Math.abs(cost("solarInstallation") - 464) < 1e-9);
  assert.equal(cost("batteryInstallation"), 400);
  assert.equal(result.inverterSummary, "2 × INV-A; 1 × INV-B");
  assert.equal(result.batterySummary, "3 × 5 kWh; 1 × 10 kWh");

  const [quoteTool, model, transfer] = await Promise.all([
    readFile(new URL("app/QuoteTool.tsx", root), "utf8"),
    readFile(new URL("lib/model.ts", root), "utf8"),
    readFile(new URL("lib/quote-transfer.ts", root), "utf8"),
  ]);
  assert.match(model, /ciPvSystems\?: CiPvSystem\[\]/);
  assert.match(model, /ciInverters\?: CiInverterSelection\[\]/);
  assert.match(model, /ciBatteries\?: CiBatterySelection\[\]/);
  assert.match(quoteTool, /Add PV system/);
  assert.match(quoteTool, /Add inverter/);
  assert.match(quoteTool, /Add battery/);
  assert.match(quoteTool, /label="Quantity"/);
  assert.match(quoteTool, /batteryModelLabel\(option\.name\)/);
  assert.match(quoteTool, /replace\(\/\^\\s\*\\d\+\\s\*\[×x\]\\s\*\/i, ""\)/);
  assert.match(quoteTool, /calculated\.totalPvSize/);
  assert.match(quoteTool, /calculated\.inverterSummary/);
  assert.match(transfer, /raw\.ciPvSystems/);
  assert.match(transfer, /raw\.ciInverters/);
  assert.match(transfer, /raw\.ciBatteries/);
});

test("uses Residential and C&I SIG catalogues with multiple equipment, gateways and accessories", async () => {
  const { calculateQuote } = await loadTypeScriptModule("lib/calculate.ts");
  const { setEquipmentBrand, setQuoteMode } = await loadTypeScriptModule("lib/quote-inputs.ts");
  const settings = {
    thresholds: { approval: 0.1, target: 0.2 },
    gstRate: 0.1,
    solarStcUnitPrice: 0,
    batteryStcUnitPrice: 10,
    stcScaleFactor: 0,
    stcYears: 0,
    panelBatchWatts: 1000,
    panelBatchCost: 0,
    accessoryCostPerKw: 0,
    solarInstallCostPerKw: 0,
    batteryInstallCost: 0,
    deliveryCost: 0,
    blinkFee: 0,
    margins: {},
    inverters: [{ name: "FOX-INV", cost: 1000 }],
    batteries: [{ name: "FOX-BAT", kwh: 10, certificates: 5, cost: 2000 }],
    sigResidentialInverters: [{ name: "SIG-RES-INV-A", cost: 3000 }, { name: "SIG-RES-INV-B", cost: 3500 }],
    sigResidentialBatteries: [{ name: "SIG-RES-BAT", kwh: 8, certificates: 0, cost: 4000 }],
    sigCiInverters: [{ name: "SIG-CI-INV", cost: 6000 }],
    sigCiBatteries: [{ name: "SIG-CI-BAT", kwh: 12, certificates: 0, cost: 7000 }],
    sigGateways: [{ name: "SIG-GATEWAY", cost: 500 }],
    sigAccessories: [{ name: "SIG-ACCESSORY", cost: 100 }],
  };
  const base = {
    ...defaultQuoteForPvSizeTest(),
    equipmentBrand: "fox",
    inverter: "FOX-INV",
    batteryKwh: 10,
  };
  const fox = calculateQuote(base, settings);
  const sigInputs = setEquipmentBrand(base, "sig", settings);
  const sig = calculateQuote({
    ...sigInputs,
    manualSolarStc: 1234,
    manualBatteryStc: 5678,
    sigInverters: [
      { id: "res-inv-a", model: "SIG-RES-INV-A", quantity: 2 },
      { id: "res-inv-b", model: "SIG-RES-INV-B", quantity: 1 },
    ],
    sigBatteries: [{ id: "res-bat", model: "SIG-RES-BAT", quantity: 3 }],
    sigGateways: [{ id: "gateway", model: "SIG-GATEWAY", quantity: 1 }],
    sigAccessories: [{ id: "accessory", model: "SIG-ACCESSORY", quantity: 4 }],
  }, settings);
  const cost = (result, key) => result.lineItems.find((item) => item.key === key).cost;

  assert.equal(sigInputs.inverter, "SIG-RES-INV-A");
  assert.equal(sigInputs.batteryKwh, 8);
  assert.equal(cost(fox, "inverter"), 1000);
  assert.equal(cost(fox, "battery"), 2000);
  assert.equal(cost(sig, "inverter"), 9500);
  assert.equal(cost(sig, "battery"), 12000);
  assert.equal(cost(sig, "sigGateway"), 500);
  assert.equal(cost(sig, "sigAccessories"), 400);
  assert.equal(sig.totalBatteryKwh, 24);
  assert.equal(sig.batteryCertificates, 0);
  assert.equal(sig.solarStc, 1234);
  assert.equal(sig.batteryStc, 5678);
  assert.equal(sig.inverterSummary, "2 × SIG-RES-INV-A; 1 × SIG-RES-INV-B");
  assert.equal(sig.gatewaySummary, "1 × SIG-GATEWAY");
  assert.equal(sig.accessoriesSummary, "4 × SIG-ACCESSORY");
  assert.equal(sig.totalSalesPriceExGst, sig.lineItems.reduce((sum, item) => sum + item.salesPrice, 0));

  const ci = setQuoteMode(sigInputs, "ci", settings);
  assert.equal(ci.sigInverters[0].model, "SIG-CI-INV");
  assert.equal(ci.sigBatteries[0].model, "SIG-CI-BAT");
  assert.equal(cost(calculateQuote({
    ...ci,
    sigInverters: [{ id: "ci-inv", model: "SIG-CI-INV", quantity: 3 }],
    sigBatteries: [{ id: "ci-bat", model: "SIG-CI-BAT", quantity: 2 }],
  }, settings), "inverter"), 18000);
  assert.equal(cost(calculateQuote({
    ...ci,
    sigInverters: [{ id: "ci-inv", model: "SIG-CI-INV", quantity: 3 }],
    sigBatteries: [{ id: "ci-bat", model: "SIG-CI-BAT", quantity: 2 }],
  }, settings), "battery"), 14000);

  const [quoteTool, defaults, model] = await Promise.all([
    readFile(new URL("app/QuoteTool.tsx", root), "utf8"),
    readFile(new URL("lib/defaults.ts", root), "utf8"),
    readFile(new URL("lib/model.ts", root), "utf8"),
  ]);
  assert.match(model, /EquipmentBrand = "fox" \| "sig"/);
  assert.match(defaults, /sigResidentialInverters/);
  assert.match(defaults, /sigResidentialBatteries/);
  assert.match(defaults, /sigCiInverters/);
  assert.match(defaults, /sigCiBatteries/);
  assert.match(defaults, /sigGateways/);
  assert.match(defaults, /sigAccessories/);
  assert.match(quoteTool, /aria-label="Equipment brand"/);
  assert.match(quoteTool, /title="FOX Inverter"/);
  assert.match(quoteTool, /title="FOX Battery"/);
  assert.match(quoteTool, /title="SIG Residential Inverter"/);
  assert.match(quoteTool, /title="SIG Residential Battery"/);
  assert.match(quoteTool, /title="SIG C&I Inverter"/);
  assert.match(quoteTool, /title="SIG C&I Battery"/);
  assert.match(quoteTool, /title="SIG Gateway"/);
  assert.match(quoteTool, /title="SIG Accessories"/);
  assert.match(quoteTool, /SIG Battery STC reference/);
  assert.match(quoteTool, /Display only · not used in calculations/);
  assert.match(quoteTool, /stcIsEditable = isCiMode \|\| equipmentBrand === "sig"/);
  assert.match(quoteTool, /Total sales price \(excl\. GST\)/);
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

test("imports XLSM and exports XLSX with imported records defaulting to done", async () => {
  const [quoteTool, importRoute, store, transfer, excel] = await Promise.all([
    readFile(new URL("app/QuoteTool.tsx", root), "utf8"),
    readFile(new URL("app/api/quotes/import/route.ts", root), "utf8"),
    readFile(new URL("lib/server/store.ts", root), "utf8"),
    readFile(new URL("lib/quote-transfer.ts", root), "utf8"),
    readFile(new URL("lib/quote-excel.ts", root), "utf8"),
  ]);

  assert.match(quoteTool, /createQuotesWorkbook\(quotes, settings\)/);
  assert.match(quoteTool, /\.xlsx,\.xlsm/);
  assert.match(quoteTool, /e3-quotes-\$\{today\(\)\}\.xlsx/);
  assert.match(quoteTool, /parseQuotesWorkbook\(await file\.arrayBuffer\(\)\)/);
  assert.match(quoteTool, /fetch\("\/api\/quotes\/import"/);
  assert.match(quoteTool, /quotes imported as Done/);
  assert.match(quoteTool, /↓ Import/);
  assert.match(quoteTool, /↑ Export all/);
  assert.match(quoteTool, /exportSingleQuote\(quote\)/);
  assert.match(quoteTool, /e3-\$\{safeExportName\(projectName\)\}-\$\{today\(\)\}\.xlsx/);
  assert.match(importRoute, /extractImportedQuotePayloads\(body\)/);
  assert.match(importRoute, /status: "done"/);
  assert.match(store, /export async function importQuotes/);
  assert.match(store, /VALUES \(\?, \?, \?, 'done', \?\)/);
  assert.match(transfer, /MAX_IMPORT_QUOTES = 500/);
  assert.match(excel, /bookType: "xlsx"/);
  assert.match(excel, /bookVBA: false/);
  assert.match(excel, /E3 Payload JSON/);
});

test("exports project breakdown sheets, round-trips XLSX and reads an XLSM quote sheet", async () => {
  const [{ createQuotesWorkbook, parseQuotesWorkbook }, XLSX, { defaultSettings }] = await Promise.all([
    import(new URL("lib/quote-excel.ts", root)),
    import("xlsx"),
    import(new URL("lib/defaults.ts", root)),
  ]);
  const payload = {
    ...defaultQuoteForPvSizeTest(),
    mode: "ci",
    date: "2026-08-07",
    customerName: "Excel Round Trip",
    pvSize: 12.5,
    customerBalance: 9000,
    manualMargins: { solarPanel: 0.18 },
    ciPvSystems: [{ id: "pv-1", sizeKw: 6.25, quantity: 2 }],
    ciInverters: [
      { id: "inv-1", model: defaultSettings.inverters[0].name, quantity: 2 },
      { id: "inv-2", model: defaultSettings.inverters[1].name, quantity: 1 },
    ],
    ciBatteries: [
      { id: "bat-1", kwh: defaultSettings.batteries[0].kwh, quantity: 2 },
      { id: "bat-2", kwh: defaultSettings.batteries[1].kwh, quantity: 1 },
    ],
  };
  const bytes = createQuotesWorkbook([{
    id: "quote-1",
    projectName: payload.customerName,
    ownerName: "Sam",
    status: "drafting",
    payload,
    createdAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
  }], defaultSettings);
  assert.ok(bytes.byteLength > 1_000);
  const exportedWorkbook = XLSX.read(bytes, { type: "array", cellFormula: true });
  assert.deepEqual(exportedWorkbook.SheetNames.slice(0, 2), ["Summary", "01 Excel Round Trip"]);
  assert.ok(exportedWorkbook.SheetNames.includes("Quotes"));
  assert.ok(exportedWorkbook.SheetNames.includes("Instructions"));
  assert.equal(exportedWorkbook.Workbook.Sheets.find((sheet) => sheet.name === "Quotes").Hidden, 1);
  assert.equal(exportedWorkbook.Sheets.Summary.A1.v, "E3 Quote Portfolio Summary");
  assert.equal(exportedWorkbook.Sheets.Summary.G6.v, 12.5);
  assert.equal(exportedWorkbook.Sheets.Summary.H6.v, 27.84);
  assert.equal(exportedWorkbook.Sheets.Summary.L6.f, "'01 Excel Round Trip'!E36");
  assert.equal(exportedWorkbook.Sheets["01 Excel Round Trip"].A11.v, "Quote Breakdown");
  assert.equal(exportedWorkbook.Sheets["01 Excel Round Trip"].D13.f, "B13*(1+C13)");
  assert.equal(exportedWorkbook.Sheets["01 Excel Round Trip"].D29.v, "Margin Summary");
  const [roundTrip] = parseQuotesWorkbook(bytes);
  assert.equal(roundTrip.customerName, "Excel Round Trip");
  assert.equal(roundTrip.mode, "ci");
  assert.equal(roundTrip.pvSize, 12.5);
  assert.deepEqual(roundTrip.manualMargins, { solarPanel: 0.18 });
  assert.deepEqual(roundTrip.ciPvSystems, payload.ciPvSystems);
  assert.deepEqual(roundTrip.ciInverters, payload.ciInverters);
  assert.deepEqual(roundTrip.ciBatteries, payload.ciBatteries);

  const xlsmWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(xlsmWorkbook, XLSX.utils.json_to_sheet([{
    "Customer Name": "Macro Workbook Quote",
    "Mode": "C&I",
    "PV System Size (kW)": 25,
    "Customer Balance (incl. GST)": 15_000,
  }]), "Imported Quotes");
  const xlsmBytes = XLSX.write(xlsmWorkbook, { type: "array", bookType: "xlsm" });
  const [xlsmQuote] = parseQuotesWorkbook(new Uint8Array(xlsmBytes));
  assert.equal(xlsmQuote.customerName, "Macro Workbook Quote");
  assert.equal(xlsmQuote.mode, "ci");
  assert.equal(xlsmQuote.pvSize, 25);
  assert.equal(xlsmQuote.customerBalance, 15_000);

  const templateRows = Array.from({ length: 77 }, () => Array(8).fill(""));
  const setTemplateCell = (address, value) => {
    const { r, c } = XLSX.utils.decode_cell(address);
    templateRows[r][c] = value;
  };
  [
    ["B10", "Project Info"], ["B28", "Quote"], ["C12", "Date"], ["D12", "25-May-2026"],
    ["C14", "Name"], ["D14", "Fox Template Customer"], ["C16", "Address"],
    ["C18", "PV Size"], ["D18", 6.6], ["C20", "Battery Size"], ["D20", 20.88],
    ["C22", "Inverter"], ["D22", "KH8 Single Phase Hybrid inverter 8KW"],
    ["C24", "E³ Energy Initiator"], ["D24", "Hogan"], ["F38", 120], ["F40", 627],
    ["F42", 1980], ["F44", 1800], ["F46", 200], ["F48", 80], ["F50", 300],
    ["F52", 400], ["F54", 0], ["F56", 250], ["D59", 1599], ["D65", 5043],
    ["D71", 1400], ["D73", 1400], ["D75", -200], ["D77", 8000],
    ["H32", 0.1], ["H34", 0.25], ["H36", 0.25], ["H38", 0.3], ["H40", 0.25],
    ["H42", 0.05], ["H44", 0.05], ["H46", 0.25], ["H48", 0.25], ["H50", 0],
    ["H52", 0.25], ["H54", 0.25], ["H56", 0.25],
  ].forEach(([address, value]) => setTemplateCell(address, value));
  const templateWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(templateWorkbook, XLSX.utils.aoa_to_sheet(templateRows), "GM check");
  const templateBytes = XLSX.write(templateWorkbook, { type: "array", bookType: "xlsm" });
  const [templateQuote] = parseQuotesWorkbook(new Uint8Array(templateBytes));
  assert.deepEqual(templateQuote, {
    customerName: "Fox Template Customer",
    date: "2026-05-25",
    mode: "residential",
    phone: "",
    address: "",
    initiator: "Hogan",
    pvSize: 6.6,
    batteryKwh: 20.88,
    inverter: "KH8 Single Phase Hybrid inverter 8KW",
    customerBalance: 8000,
    solarVicRebate: 1400,
    solarVicLoan: 1400,
    discount: 200,
    manualSolarStc: 1599,
    manualBatteryStc: 5043,
    manualCosts: {
      backup: 120,
      accessories: 627,
      solarInstallation: 1980,
      batteryInstallation: 1800,
      delivery: 200,
      acCable: 80,
      blinkFee: 300,
      switchboard: 400,
      subSwitchboard: 0,
      externalCommission: 250,
    },
    manualMargins: {
      solarPanel: 0.1,
      inverter: 0.25,
      battery: 0.25,
      backup: 0.3,
      accessories: 0.25,
      solarInstallation: 0.05,
      batteryInstallation: 0.05,
      delivery: 0.25,
      acCable: 0.25,
      blinkFee: 0,
      switchboard: 0.25,
      subSwitchboard: 0.25,
      externalCommission: 0.25,
    },
    customItems: [],
  });
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
