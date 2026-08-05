export type Role = "admin" | "user";

export type CatalogItem = {
  name: string;
  cost: number;
};

export type BatteryItem = CatalogItem & {
  kwh: number;
  certificates: number;
};

export type AppSettings = {
  thresholds: { approval: number; target: number };
  gstRate: number;
  solarStcUnitPrice: number;
  batteryStcUnitPrice: number;
  stcScaleFactor: number;
  stcYears: number;
  panelBatchWatts: number;
  panelBatchCost: number;
  accessoryCostPerKw: number;
  solarInstallCostPerWatt: number;
  batteryInstallCost: number;
  deliveryCost: number;
  blinkFee: number;
  margins: Record<string, number>;
  inverters: CatalogItem[];
  batteries: BatteryItem[];
};

export type QuoteInputs = {
  date: string;
  customerName: string;
  phone: string;
  address: string;
  pvSize: number;
  batteryKwh: number;
  inverter: string;
  initiator: string;
  customerBalance: number;
  solarVicRebate: number;
  solarVicLoan: number;
  discount: number;
  manualCosts: {
    solarPanel?: number;
    backup: number;
    accessories?: number;
    solarInstallation?: number;
    batteryInstallation?: number;
    delivery?: number;
    acCable: number;
    blinkFee?: number;
    switchboard: number;
    subSwitchboard: number;
    externalCommission: number;
  };
};

export type QuoteRecord = {
  id: string;
  projectName: string;
  payload: QuoteInputs;
  createdAt: string;
  updatedAt: string;
};

export type Viewer = {
  userId: string;
  email: string;
  displayName: string;
  role: Role;
  isLocalDemo: boolean;
};

export type LineItemResult = {
  key: string;
  label: string;
  cost: number;
  margin: number;
  salesPrice: number;
  editableByUser: boolean;
  note?: string;
};

export type CalculationResult = {
  lineItems: LineItemResult[];
  solarCertificates: number;
  solarStc: number;
  batteryCertificates: number;
  batteryStc: number;
  totalReceivedExGst: number;
  totalCostExGst: number;
  netGst: number;
  gstPayment: number;
  gstRefund: number;
  grossMargin: number;
  grossMarginRate: number;
  quoteRequiredBalance: number;
  targetRequiredBalance: number;
  targetGap: number;
  status: "healthy" | "review" | "approval";
};
