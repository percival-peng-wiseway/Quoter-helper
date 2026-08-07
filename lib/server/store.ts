import { getRawDb } from "../../db";
import { getAuthenticatedAccount } from "./auth";
import { defaultSettings, normalizeSettings } from "../defaults";
import type { AppSettings, QuoteInputs, QuoteRecord, QuoteStatus, Role, SystemNotification, Viewer } from "../model";

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  const db = getRawDb();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      project_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'drafting' CHECK (status IN ('drafting', 'done')),
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS system_notifications (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_quotes_owner_updated ON quotes(owner_id, updated_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_system_notifications_created ON system_notifications(created_at DESC)"),
  ]);
  schemaReady = true;
}

export async function requireViewer(): Promise<Viewer> {
  await ensureSchema();
  const identity = await getAuthenticatedAccount();
  if (!identity) throw new Response("Authentication required", { status: 401 });

  await getRawDb().prepare("INSERT OR IGNORE INTO app_settings (id, payload, updated_by) VALUES (1, ?, ?)")
    .bind(JSON.stringify(defaultSettings), identity.userId)
    .run();

  return {
    userId: identity.userId,
    email: identity.email,
    displayName: identity.displayName,
    role: identity.role,
    isLocalDemo: false,
  };
}

export async function getSettings(): Promise<AppSettings> {
  await ensureSchema();
  const row = await getRawDb().prepare("SELECT payload FROM app_settings WHERE id = 1")
    .first<{ payload: string }>();
  return row ? normalizeSettings(JSON.parse(row.payload) as AppSettings) : defaultSettings;
}

export async function updateSettings(viewer: Viewer, settings: AppSettings) {
  if (viewer.role !== "admin") throw new Response("Forbidden", { status: 403 });
  const db = getRawDb();
  const previous = await db.prepare("SELECT payload FROM app_settings WHERE id = 1")
    .first<{ payload: string }>();
  const previousSettings = previous ? normalizeSettings(JSON.parse(previous.payload) as AppSettings) : defaultSettings;
  const normalizedSettings = normalizeSettings(settings);
  const message = describeSettingsChange(previousSettings, normalizedSettings);
  const updates = [db.prepare(`UPDATE app_settings
    SET payload = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
    .bind(JSON.stringify(normalizedSettings), viewer.userId)
  ];
  if (message) {
    updates.push(db.prepare(`INSERT INTO system_notifications (id, message, created_by)
      VALUES (?, ?, ?)`)
      .bind(crypto.randomUUID(), message, viewer.userId));
  }
  await db.batch(updates);
}

function describeSettingsChange(before: AppSettings, after: AppSettings): string | null {
  const changed: string[] = [];
  const number = (value: number) => new Intl.NumberFormat("en-AU", { maximumFractionDigits: 4 }).format(value);
  const money = (value: number) => new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 2 }).format(value);
  const percent = (value: number) => `${number(value * 100)}%`;
  const add = (label: string, oldValue: string | number, newValue: string | number) => {
    if (oldValue !== newValue) changed.push(`${label}: ${oldValue} → ${newValue}`);
  };

  add("Senior approval threshold", percent(before.thresholds.approval), percent(after.thresholds.approval));
  add("Target gross margin", percent(before.thresholds.target), percent(after.thresholds.target));

  const parameters: Array<[keyof AppSettings, string, (value: number) => string]> = [
    ["gstRate", "GST rate", percent],
    ["solarStcUnitPrice", "Solar STC unit price", money],
    ["batteryStcUnitPrice", "Battery STC unit price", money],
    ["stcScaleFactor", "STC scale factor", number],
    ["stcYears", "STC years", number],
    ["panelBatchWatts", "Panel batch watts", number],
    ["panelBatchCost", "Panel batch cost", money],
    ["accessoryCostPerKw", "Accessories cost / kW", money],
    ["solarInstallCostPerKw", "Solar installation cost / PV system kW", money],
    ["batteryInstallCost", "Battery installation cost", money],
    ["deliveryCost", "Delivery cost", money],
    ["blinkFee", "Blink fee", money],
  ];
  parameters.forEach(([key, label, format]) => {
    const oldValue = before[key];
    const newValue = after[key];
    if (typeof oldValue === "number" && typeof newValue === "number") add(label, format(oldValue), format(newValue));
  });

  const marginLabels: Record<string, string> = {
    solarPanel: "Solar panel margin", inverter: "Inverter margin", battery: "Battery margin",
    backup: "Backup margin", accessories: "Accessories margin", solarInstallation: "Solar installation margin",
    batteryInstallation: "Battery installation margin", delivery: "Delivery margin", acCable: "AC cable run margin",
    blinkFee: "Blink fee margin", switchboard: "Switchboard upgrade margin", subSwitchboard: "Sub switchboard margin",
    externalCommission: "External commission margin",
  };
  new Set([...Object.keys(before.margins), ...Object.keys(after.margins)]).forEach((key) => {
    add(marginLabels[key] ?? `${key} margin`, percent(before.margins[key] ?? 0), percent(after.margins[key] ?? 0));
  });

  const inverterCount = Math.max(before.inverters.length, after.inverters.length);
  for (let index = 0; index < inverterCount; index += 1) {
    const oldItem = before.inverters[index];
    const newItem = after.inverters[index];
    if (!oldItem && newItem) changed.push(`Inverter added: ${newItem.name} (${money(newItem.cost)})`);
    else if (oldItem && !newItem) changed.push(`Inverter removed: ${oldItem.name} (${money(oldItem.cost)})`);
    else if (oldItem && newItem) {
      add(`Inverter ${index + 1} model`, oldItem.name, newItem.name);
      add(`${newItem.name} cost`, money(oldItem.cost), money(newItem.cost));
    }
  }

  const batteryCount = Math.max(before.batteries.length, after.batteries.length);
  for (let index = 0; index < batteryCount; index += 1) {
    const oldItem = before.batteries[index];
    const newItem = after.batteries[index];
    if (!oldItem && newItem) changed.push(`Battery added: ${newItem.name}`);
    else if (oldItem && !newItem) changed.push(`Battery removed: ${oldItem.name}`);
    else if (oldItem && newItem) {
      add(`Battery ${index + 1} name`, oldItem.name, newItem.name);
      add(`Battery ${index + 1} capacity`, `${number(oldItem.kwh)} kWh`, `${number(newItem.kwh)} kWh`);
      add(`Battery ${index + 1} cost`, money(oldItem.cost), money(newItem.cost));
      add(`Battery ${index + 1} STC certificates`, number(oldItem.certificates), number(newItem.certificates));
    }
  }

  return changed.length > 0 ? changed.join("\n") : null;
}

export async function listNotifications(): Promise<SystemNotification[]> {
  await ensureSchema();
  const result = await getRawDb().prepare(`SELECT n.id, n.message, n.created_at,
      COALESCE(u.display_name, 'Administrator') AS created_by
    FROM system_notifications n
    LEFT JOIN users u ON u.user_id = n.created_by
    ORDER BY n.created_at DESC LIMIT 20`)
    .all<{ id: string; message: string; created_at: string; created_by: string }>();
  return result.results.map((row) => ({
    id: row.id,
    message: row.message,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

export async function listQuotes(): Promise<QuoteRecord[]> {
  const result = await getRawDb().prepare(`SELECT q.id, q.project_name, q.status, q.payload,
      q.created_at, q.updated_at, COALESCE(u.display_name, 'Former user') AS owner_name
    FROM quotes q
    LEFT JOIN users u ON u.user_id = q.owner_id
    ORDER BY q.updated_at DESC`)
    .all<{ id: string; project_name: string; owner_name: string; status: QuoteStatus; payload: string; created_at: string; updated_at: string }>();
  return result.results.map((row) => ({
    id: row.id,
    projectName: row.project_name,
    ownerName: row.owner_name,
    status: row.status,
    payload: JSON.parse(row.payload) as QuoteInputs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function saveQuote(viewer: Viewer, id: string | null, payload: QuoteInputs): Promise<string> {
  const customerName = payload.customerName.trim();
  if (!customerName) throw Response.json({ error: "Need a Customer Name" }, { status: 400 });
  const quoteId = id ?? crypto.randomUUID();
  const projectName = customerName;
  await getRawDb().prepare(`INSERT INTO quotes (id, owner_id, project_name, payload)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET project_name = excluded.project_name,
      payload = excluded.payload, updated_at = CURRENT_TIMESTAMP`)
    .bind(quoteId, viewer.userId, projectName, JSON.stringify(payload))
    .run();
  return quoteId;
}

export async function importQuotes(viewer: Viewer, payloads: QuoteInputs[]): Promise<number> {
  const db = getRawDb();
  for (let start = 0; start < payloads.length; start += 50) {
    const batch = payloads.slice(start, start + 50).map((payload) => db.prepare(`INSERT INTO quotes
      (id, owner_id, project_name, status, payload) VALUES (?, ?, ?, 'done', ?)`)
      .bind(crypto.randomUUID(), viewer.userId, payload.customerName.trim(), JSON.stringify(payload)));
    await db.batch(batch);
  }
  return payloads.length;
}

export async function updateQuoteStatus(_viewer: Viewer, id: string, status: QuoteStatus) {
  const existing = await getRawDb().prepare("SELECT id FROM quotes WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) throw new Response("Quote not found", { status: 404 });
  await getRawDb().prepare("UPDATE quotes SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(status, id)
    .run();
}

export async function deleteQuote(viewer: Viewer, id: string) {
  if (viewer.role !== "admin") throw new Response("Forbidden", { status: 403 });
  const existing = await getRawDb().prepare("SELECT id FROM quotes WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();
  if (!existing) throw new Response("Quote not found", { status: 404 });
  await getRawDb().prepare("DELETE FROM quotes WHERE id = ?").bind(id).run();
}

export async function listUsers(viewer: Viewer) {
  if (viewer.role !== "admin") return [];
  const result = await getRawDb().prepare(`SELECT user_id, email, display_name, role, created_at
    FROM users WHERE user_id LIKE 'password-account:%' ORDER BY created_at ASC`).all<{
      user_id: string; email: string; display_name: string; role: Role; created_at: string;
    }>();
  return result.results.map((row) => ({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    createdAt: row.created_at,
  }));
}
