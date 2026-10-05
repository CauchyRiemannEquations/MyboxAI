import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";
export const myboxConnections = sqliteTable("mybox_connections", {
  userId: text("user_id").primaryKey(),
  encryptedToken: text("encrypted_token").notNull(),
  connectedAt: text("connected_at").notNull(),
});
export const ocrSettings = sqliteTable("ocr_settings", {
  userId: text("user_id").primaryKey(),
  encryptedKey: text("encrypted_key").notNull(),
  dailyLimit: integer("daily_limit").notNull().default(50),
  updatedAt: text("updated_at").notNull(),
});
export const ocrUsage = sqliteTable("ocr_usage", {
  userId: text("user_id").notNull(),
  day: text("day").notNull(),
  pages: integer("pages").notNull(),
}, table => [primaryKey({ columns: [table.userId, table.day] })]);
export const ocrCache = sqliteTable("ocr_cache", {
  cacheKey: text("cache_key").primaryKey(),
  userId: text("user_id").notNull(),
  encryptedText: text("encrypted_text").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, table => [index("idx_ocr_cache_user").on(table.userId)]);
