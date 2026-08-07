import type { AppSettings, CalculationResult, LineItemResult, QuoteInputs } from "./model";

const finite = (value: number) => (Number.isFinite(value) ? value : 0);

export function calculateQuote(
  inputs: QuoteInputs,
  settings: AppSettings,
): CalculationResult {
  const pvSize = Math.max(0, finite(inputs.pvSize));
  const battery = settings.batteries.find((item) => Math.abs(item.kwh - inputs.batteryKwh) < 0.001);
  const inverter = settings.inverters.find((item) => item.name === inputs.inverter);
  const manualCost = (key: keyof QuoteInputs["manualCosts"], fallback: number) => {
    const override = inputs.manualCosts?.[key];
    return typeof override === "number" && Number.isFinite(override)
      ? Math.max(0, override)
      : fallback;
  };
  const costs = {
    solarPanel: manualCost("solarPanel", settings.panelBatchCost * Math.ceil((pvSize * 1000) / settings.panelBatchWatts)),
    inverter: inverter?.cost ?? 0,
    battery: battery?.cost ?? 0,
    backup: manualCost("backup", 0),
    accessories: manualCost("accessories", pvSize * settings.accessoryCostPerKw),
    solarInstallation: manualCost("solarInstallation", pvSize * settings.solarInstallCostPerKw),
    batteryInstallation: manualCost("batteryInstallation", settings.batteryInstallCost),
    delivery: manualCost("delivery", settings.deliveryCost),
    acCable: manualCost("acCable", 0),
    blinkFee: manualCost("blinkFee", settings.blinkFee),
    switchboard: manualCost("switchboard", 0),
    subSwitchboard: manualCost("subSwitchboard", 0),
    externalCommission: manualCost("externalCommission", 0),
  };

  const definitions: Array<[keyof typeof costs, string, boolean, string?]> = [
    ["solarPanel", "Solar Panel", true],
    ["inverter", "Inverter", false],
    ["battery", "Battery", false],
    ["backup", "Backup", true],
    ["accessories", "Accessories (cables, bracket, etc.)", true],
    ["solarInstallation", "Solar Installation", true],
    ["batteryInstallation", "Battery Installation", true],
    ["delivery", "Delivery", true],
    ["acCable", "AC cable run", true],
    ["blinkFee", "Blink Fee", true],
    ["switchboard", "Switchboard Upgrade", true],
    ["subSwitchboard", "sub switchboard", true],
    ["externalCommission", "External Commission incl. GST", true],
  ];

  const isCiMode = inputs.mode === "ci";
  const marginFor = (key: keyof typeof costs) => {
    const override = isCiMode ? inputs.manualMargins?.[key] : undefined;
    return typeof override === "number" && Number.isFinite(override)
      ? Math.max(0, override)
      : Math.max(0, settings.margins[key] ?? 0);
  };
  const standardLineItems: LineItemResult[] = definitions.map(([key, label, editableByUser, note]) => {
    const margin = marginFor(key);
    return {
      key,
      label,
      cost: costs[key],
      margin,
      salesPrice: costs[key] * (1 + margin),
      editableByUser,
      note,
    };
  });
  const customLineItems: LineItemResult[] = (inputs.customItems ?? []).map((item) => {
    const cost = Math.max(0, finite(item.cost));
    const margin = Math.max(0, finite(item.margin));
    return {
      key: `custom:${item.id}`,
      label: item.name.trim() || "Custom item",
      cost,
      margin,
      salesPrice: cost * (1 + margin),
      editableByUser: true,
      customItemId: item.id,
      customItemName: item.name,
    };
  });
  const lineItems = [...standardLineItems, ...customLineItems];

  const commission = lineItems.find((item) => item.key === "externalCommission")!;
  const normalItems = lineItems.filter((item) => item.key !== "externalCommission");
  const solarCertificates = Math.floor(pvSize * settings.stcScaleFactor * settings.stcYears);
  const calculatedSolarStc = solarCertificates * settings.solarStcUnitPrice;
  const batteryCertificates = battery?.certificates ?? 0;
  const calculatedBatteryStc = batteryCertificates * settings.batteryStcUnitPrice;
  const manualStc = (value: number | undefined, fallback: number) => isCiMode && typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : fallback;
  const solarStc = manualStc(inputs.manualSolarStc, calculatedSolarStc);
  const batteryStc = manualStc(inputs.manualBatteryStc, calculatedBatteryStc);
  const solarVicRebate = Math.max(0, finite(inputs.solarVicRebate));
  const solarVicLoan = Math.max(0, finite(inputs.solarVicLoan));
  // Older saved quotes used negative discounts. Treat either sign as a deduction.
  const discount = Math.abs(finite(inputs.discount));
  const additionalDeductions = solarVicRebate + solarVicLoan + discount;
  const customerDeductions = solarStc + batteryStc + additionalDeductions;
  const receivedFundingTotal = solarStc + batteryStc + solarVicRebate + solarVicLoan - discount;

  const sumNormalSales = normalItems.reduce((sum, item) => sum + item.salesPrice, 0);
  const sumAllCosts = lineItems.reduce((sum, item) => sum + item.cost, 0);
  const sumAllSales = lineItems.reduce((sum, item) => sum + item.salesPrice, 0);
  const quoteRequiredBalance = sumNormalSales * (1 + settings.gstRate) + commission.salesPrice - customerDeductions;
  const totalReceivedExGst = receivedFundingTotal + finite(inputs.customerBalance) / (1 + settings.gstRate);
  const totalCostExGst = normalItems.reduce((sum, item) => sum + item.cost, 0) + commission.cost / (1 + settings.gstRate);
  const gstPayment = finite(inputs.customerBalance) * settings.gstRate / (1 + settings.gstRate);
  const gstRefund = sumAllCosts * settings.gstRate;
  const netGst = gstPayment - gstRefund;
  const grossMargin = totalReceivedExGst - totalCostExGst - netGst;
  const grossMarginRate = totalReceivedExGst === 0 ? 0 : grossMargin / totalReceivedExGst;

  const requiredBalanceForMargin = (target: number) => {
    const denominator = 1 - settings.gstRate - target;
    const numerator = (1 + settings.gstRate) * (
      totalCostExGst - gstRefund - receivedFundingTotal * (1 - target)
    );
    return denominator <= 0 ? 0 : Math.max(0, numerator / denominator);
  };
  const targetRequiredBalance = requiredBalanceForMargin(settings.thresholds.target);
  const margin15RequiredBalance = requiredBalanceForMargin(0.15);
  const margin20RequiredBalance = requiredBalanceForMargin(0.2);
  const targetGap = targetRequiredBalance - finite(inputs.customerBalance);

  const status = grossMarginRate >= settings.thresholds.target
    ? "healthy"
    : grossMarginRate >= settings.thresholds.approval
      ? "review"
      : "approval";

  return {
    lineItems,
    solarCertificates,
    solarStc,
    batteryCertificates,
    batteryStc,
    totalReceivedExGst,
    totalCostExGst,
    netGst,
    gstPayment,
    gstRefund,
    lineItemCostTotal: sumAllCosts - customerDeductions,
    lineItemSalesTotal: sumAllSales - customerDeductions,
    grossMargin,
    grossMarginRate,
    quoteRequiredBalance,
    targetRequiredBalance,
    margin15RequiredBalance,
    margin20RequiredBalance,
    targetGap,
    status,
  };
}
