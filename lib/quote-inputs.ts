import type { AppSettings, QuoteInputs, QuoteMode } from "./model";

const positiveQuantity = (value: number) => Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;

export function normalizeQuoteConfiguration(inputs: QuoteInputs, settings?: AppSettings): QuoteInputs {
  if ((inputs.mode ?? "residential") !== "ci") return { ...inputs, mode: "residential" };

  const fallbackInverter = inputs.inverter || settings?.inverters[0]?.name || "";
  const fallbackBattery = Number.isFinite(inputs.batteryKwh)
    ? Math.max(0, inputs.batteryKwh)
    : settings?.batteries[0]?.kwh ?? 0;
  const ciPvSystems = inputs.ciPvSystems?.length ? inputs.ciPvSystems.map((item, index) => ({
    id: item.id || `ci-pv-${index + 1}`,
    sizeKw: Number.isFinite(item.sizeKw) ? Math.max(0, item.sizeKw) : 0,
    quantity: positiveQuantity(item.quantity),
  })) : [{ id: "ci-pv-1", sizeKw: Math.max(0, inputs.pvSize || 0), quantity: 1 }];
  const ciInverters = inputs.ciInverters?.length ? inputs.ciInverters.map((item, index) => ({
    id: item.id || `ci-inverter-${index + 1}`,
    model: item.model || fallbackInverter,
    quantity: positiveQuantity(item.quantity),
  })) : [{ id: "ci-inverter-1", model: fallbackInverter, quantity: 1 }];
  const ciBatteries = inputs.ciBatteries?.length ? inputs.ciBatteries.map((item, index) => ({
    id: item.id || `ci-battery-${index + 1}`,
    kwh: Number.isFinite(item.kwh) ? Math.max(0, item.kwh) : fallbackBattery,
    quantity: positiveQuantity(item.quantity),
  })) : [{ id: "ci-battery-1", kwh: fallbackBattery, quantity: 1 }];

  return syncCiLegacyFields({ ...inputs, mode: "ci", ciPvSystems, ciInverters, ciBatteries });
}

export function syncCiLegacyFields(inputs: QuoteInputs): QuoteInputs {
  if (inputs.mode !== "ci") return inputs;
  const pvSize = (inputs.ciPvSystems ?? []).reduce((sum, item) => sum + Math.max(0, item.sizeKw) * positiveQuantity(item.quantity), 0);
  const batteryKwh = (inputs.ciBatteries ?? []).reduce((sum, item) => sum + Math.max(0, item.kwh) * positiveQuantity(item.quantity), 0);
  const inverter = inputs.ciInverters?.[0]?.model ?? inputs.inverter;
  return { ...inputs, pvSize, batteryKwh, inverter };
}

export function setQuoteMode(inputs: QuoteInputs, mode: QuoteMode, settings: AppSettings): QuoteInputs {
  return mode === "ci"
    ? normalizeQuoteConfiguration({ ...inputs, mode }, settings)
    : {
      ...inputs,
      mode,
      inverter: inputs.ciInverters?.[0]?.model ?? inputs.inverter,
      batteryKwh: inputs.ciBatteries?.[0]?.kwh ?? inputs.batteryKwh,
    };
}

export function updatePvSize(inputs: QuoteInputs, pvSize: number): QuoteInputs {
  const manualCosts = { ...inputs.manualCosts };
  delete manualCosts.accessories;
  delete manualCosts.solarInstallation;

  return {
    ...inputs,
    pvSize: Number.isFinite(pvSize) ? Math.max(0, pvSize) : 0,
    manualCosts,
  };
}
