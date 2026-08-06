import type { QuoteInputs } from "./model";

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
