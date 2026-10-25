import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const scouts = sqliteTable("scouts", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
  status: text("status").notNull().default("active"),
  nextRunAt: integer("next_run_at").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("scouts_due_idx").on(table.status, table.nextRunAt)]);

export const items = sqliteTable("items", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
  firstSeenAt: integer("first_seen_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(),
  scoutId: text("scout_id").notNull(),
  itemId: text("item_id").notNull(),
  data: text("data").notNull(),
  userState: text("user_state").notNull().default("new"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("matches_scout_item_idx").on(table.scoutId, table.itemId)]);

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  scoutId: text("scout_id").notNull(),
  stage: text("stage").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("pending"),
  availableAt: integer("available_at").notNull(),
  leaseUntil: integer("lease_until"),
  attempts: integer("attempts").notNull().default(0),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("jobs_due_idx").on(table.status, table.availableAt)]);

export const activity = sqliteTable("activity", {
  id: text("id").primaryKey(),
  scoutId: text("scout_id"),
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const alerts = sqliteTable("alerts", {
  id: text("id").primaryKey(),
  scoutId: text("scout_id").notNull(),
  itemId: text("item_id").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  providerId: text("provider_id"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("alerts_scout_item_type_idx").on(table.scoutId, table.itemId, table.type)]);
