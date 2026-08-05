import { getChatGPTUser } from "../../app/chatgpt-auth";
import { getRawDb } from "../../db";
import { defaultSettings } from "../defaults";
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

async function requestIdentity() {
  const authenticated = await getChatGPTUser();
  if (authenticated) {
    return { ...authenticated, isLocalDemo: false };
  }
  if (process.env.NODE_ENV !== "production") {
    return {
      userId: "local-demo-admin",
      email: "admin@local.preview",
      displayName: "Local Admin",
      fullName: "Local Admin",
      isLocalDemo: true,
    };
  }
  return null;
}

export async function requireViewer(): Promise<Viewer> {
  await ensureSchema();
  const identity = await requestIdentity();
  if (!identity) throw new Response("Authentication required", { status: 401 });
  const db = getRawDb();

  const existing = await db.prepare("SELECT user_id, email, display_name, role FROM users WHERE user_id = ?")
    .bind(identity.userId)
    .first<{ user_id: string; email: string; display_name: string; role: Role }>();

  if (!existing) {
    await db.prepare(`INSERT INTO users (user_id, email, display_name, role)
      SELECT ?, ?, ?, CASE WHEN NOT EXISTS (SELECT 1 FROM users) THEN 'admin' ELSE 'user' END`)
      .bind(identity.userId, identity.email, identity.displayName)
      .run();
  } else if (existing.email !== identity.email || existing.display_name !== identity.displayName) {
    await db.prepare("UPDATE users SET email = ?, display_name = ? WHERE user_id = ?")
      .bind(identity.email, identity.displayName, identity.userId)
      .run();
  }

  const row = await db.prepare("SELECT user_id, email, display_name, role FROM users WHERE user_id = ?")
    .bind(identity.userId)
    .first<{ user_id: string; email: string; display_name: string; role: Role }>();
  if (!row) throw new Error("Unable to initialize user account");

  await db.prepare("INSERT OR IGNORE INTO app_settings (id, payload, updated_by) VALUES (1, ?, ?)")
    .bind(JSON.stringify(defaultSettings), identity.userId)
    .run();

  return {
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    isLocalDemo: identity.isLocalDemo,
  };
}

export async function getSettings(): Promise<AppSettings> {
  await ensureSchema();
  const row = await getRawDb().prepare("SELECT payload FROM app_settings WHERE id = 1")
    .first<{ payload: string }>();
  return row ? JSON.parse(row.payload) as AppSettings : defaultSettings;
}

export async function updateSettings(viewer: Viewer, settings: AppSettings) {
  if (viewer.role !== "admin") throw new Response("Forbidden", { status: 403 });
  const db = getRawDb();
  const previous = await db.prepare("SELECT payload FROM app_settings WHERE id = 1")
    .first<{ payload: string }>();
  const previousSettings = previous ? JSON.parse(previous.payload) as AppSettings : defaultSettings;
  const message = describeSettingsChange(previousSettings, settings);
  const updates = [db.prepare(`UPDATE app_settings
    SET payload = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
    .bind(JSON.stringify(settings), viewer.userId)
  ];
  if (message) {
    updates.push(db.prepare(`INSERT INTO system_notifications (id, message, created_by)
      VALUES (?, ?, ?)`)
      .bind(crypto.randomUUID(), message, viewer.userId));
  }
  await db.batch(updates);
}

function describeSettingsChange(before: AppSettings, after: AppSettings): string | null {
  const { inverters: beforeInverters, batteries: beforeBatteries, ...beforeParameters } = before;
  const { inverters: afterInverters, batteries: afterBatteries, ...afterParameters } = after;
  const changed: string[] = [];
  if (JSON.stringify(beforeParameters) !== JSON.stringify(afterParameters)) changed.push("Model parameters");
  if (JSON.stringify(beforeInverters) !== JSON.stringify(afterInverters)) changed.push("Inverter catalogue");
  if (JSON.stringify(beforeBatteries) !== JSON.stringify(afterBatteries)) changed.push("Battery catalogue");
  if (changed.length === 0) return null;
  if (changed.length === 1) return `${changed[0]} updated`;
  return `${changed.slice(0, -1).join(", ")} and ${changed.at(-1)} updated`;
}

export async function listNotifications(): Promise<SystemNotification[]> {
  await ensureSchema();
  const result = await getRawDb().prepare(`SELECT n.id, n.message, n.created_at,
      COALESCE(u.display_name, 'Administrator') AS created_by
    FROM system_notifications n
    LEFT JOIN users u ON u.user_id = n.created_by
    ORDER BY n.created_at DESC LIMIT 5`)
    .all<{ id: string; message: string; created_at: string; created_by: string }>();
  return result.results.map((row) => ({
    id: row.id,
    message: row.message,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

export async function listQuotes(viewer: Viewer): Promise<QuoteRecord[]> {
  const result = await getRawDb().prepare(`SELECT id, project_name, status, payload, created_at, updated_at
    FROM quotes WHERE owner_id = ? ORDER BY updated_at DESC LIMIT 20`)
    .bind(viewer.userId)
    .all<{ id: string; project_name: string; status: QuoteStatus; payload: string; created_at: string; updated_at: string }>();
  return result.results.map((row) => ({
    id: row.id,
    projectName: row.project_name,
    status: row.status,
    payload: JSON.parse(row.payload) as QuoteInputs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function saveQuote(viewer: Viewer, id: string | null, payload: QuoteInputs): Promise<string> {
  const quoteId = id ?? crypto.randomUUID();
  const existing = await getRawDb().prepare("SELECT owner_id FROM quotes WHERE id = ?")
    .bind(quoteId)
    .first<{ owner_id: string }>();
  if (existing && existing.owner_id !== viewer.userId) throw new Response("Forbidden", { status: 403 });

  const projectName = payload.customerName.trim() || payload.address.trim() || "Untitled quote";
  await getRawDb().prepare(`INSERT INTO quotes (id, owner_id, project_name, payload)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET project_name = excluded.project_name,
      payload = excluded.payload, updated_at = CURRENT_TIMESTAMP`)
    .bind(quoteId, viewer.userId, projectName, JSON.stringify(payload))
    .run();
  return quoteId;
}

export async function updateQuoteStatus(viewer: Viewer, id: string, status: QuoteStatus) {
  const existing = await getRawDb().prepare("SELECT owner_id FROM quotes WHERE id = ?")
    .bind(id)
    .first<{ owner_id: string }>();
  if (!existing) throw new Response("Quote not found", { status: 404 });
  if (existing.owner_id !== viewer.userId) throw new Response("Forbidden", { status: 403 });
  await getRawDb().prepare("UPDATE quotes SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(status, id)
    .run();
}

export async function listUsers(viewer: Viewer) {
  if (viewer.role !== "admin") return [];
  const result = await getRawDb().prepare(`SELECT user_id, email, display_name, role, created_at
    FROM users ORDER BY created_at ASC`).all<{
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

export async function updateUserRole(viewer: Viewer, userId: string, role: Role) {
  if (viewer.role !== "admin") throw new Response("Forbidden", { status: 403 });
  if (viewer.userId === userId && role !== "admin") {
    throw new Response("You cannot remove your own administrator access", { status: 400 });
  }
  await getRawDb().prepare("UPDATE users SET role = ? WHERE user_id = ?").bind(role, userId).run();
}
