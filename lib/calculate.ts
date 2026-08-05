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
    solarInstallation: manualCost("solarInstallation", pvSize * 1000 * settings.solarInstallCostPerWatt),
    batteryInstallation: manualCost("batteryInstallation", settings.batteryInstallCost),
    delivery: manualCost("delivery", settings.deliveryCost),
    acCable: manualCost("acCable", 0),
    blinkFee: manualCost("blinkFee", settings.blinkFee),
    switchboard: manualCost("switchboard", 0),
    subSwitchboard: manualCost("subSwitchboard", 0),
    externalCommission: manualCost("externalCommission", 0),
  };

  const definitions: Array<[keyof typeof costs, string, boolean, string?]> = [
    ["solarPanel", "Solar Panel", true, `${settings.panelBatchWatts}W panel batches`],
    ["inverter", "Inverter", false],
    ["battery", "Battery", false],
    ["backup", "Backup", true],
    ["accessories", "Accessories (cables, bracket, etc.)", true, `$${settings.accessoryCostPerKw.toFixed(0)} / kW`],
    ["solarInstallation", "Solar Installation", true, `$${settings.solarInstallCostPerWatt.toFixed(2)} / W`],
    ["batteryInstallation", "Battery Installation", true],
    ["delivery", "Delivery", true],
    ["acCable", "AC cable run", true],
    ["blinkFee", "Blink Fee", true],
    ["switchboard", "Switchboard Upgrade", true],
    ["subSwitchboard", "sub switchboard", true],
    ["externalCommission", "External Commission incl. GST", true],
  ];

  const lineItems: LineItemResult[] = definitions.map(([key, label, editableByUser, note]) => ({
    key,
    label,
    cost: costs[key],
    margin: settings.margins[key] ?? 0,
    salesPrice: costs[key] * (1 + (settings.margins[key] ?? 0)),
    editableByUser,
    note,
  }));

  const commission = lineItems.find((item) => item.key === "externalCommission")!;
  const normalItems = lineItems.filter((item) => item.key !== "externalCommission");
  const solarCertificates = Math.floor(pvSize * settings.stcScaleFactor * settings.stcYears);
  const solarStc = solarCertificates * settings.solarStcUnitPrice;
  const batteryCertificates = battery?.certificates ?? 0;
  const batteryStc = batteryCertificates * settings.batteryStcUnitPrice;
  const otherFunding = finite(inputs.solarVicRebate) + finite(inputs.solarVicLoan) + Math.min(0, finite(inputs.discount));
  const fundingTotal = solarStc + batteryStc + otherFunding;

  const sumNormalSales = normalItems.reduce((sum, item) => sum + item.salesPrice, 0);
  const sumAllCosts = lineItems.reduce((sum, item) => sum + item.cost, 0);
  const quoteRequiredBalance = sumNormalSales * (1 + settings.gstRate) + commission.salesPrice - fundingTotal;
  const totalReceivedExGst = fundingTotal + finite(inputs.customerBalance) / (1 + settings.gstRate);
  const totalCostExGst = normalItems.reduce((sum, item) => sum + item.cost, 0) + commission.cost / (1 + settings.gstRate);
  const gstPayment = finite(inputs.customerBalance) * settings.gstRate / (1 + settings.gstRate);
  const gstRefund = sumAllCosts * settings.gstRate;
  const netGst = gstPayment - gstRefund;
  const grossMargin = totalReceivedExGst - totalCostExGst - netGst;
  const grossMarginRate = totalReceivedExGst === 0 ? 0 : grossMargin / totalReceivedExGst;

  const target = settings.thresholds.target;
  const denominator = 1 - settings.gstRate - target;
  const numerator = (1 + settings.gstRate) * (
    totalCostExGst - gstRefund - fundingTotal * (1 - target)
  );
  const targetRequiredBalance = denominator <= 0 ? 0 : Math.max(0, numerator / denominator);
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
    grossMargin,
    grossMarginRate,
    quoteRequiredBalance,
    targetRequiredBalance,
    targetGap,
    status,
  };
}
