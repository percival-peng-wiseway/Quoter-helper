import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  payload: text("payload").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const quotes = sqliteTable(
  "quotes",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    projectName: text("project_name").notNull(),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_quotes_owner_updated").on(table.ownerId, table.updatedAt)],
);

export const systemNotifications = sqliteTable(
  "system_notifications",
  {
    id: text("id").primaryKey(),
    message: text("message").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_system_notifications_created").on(table.createdAt)],
);
