import { bigint, jsonb, pgTable, text, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botGroups = pgTable("bot_groups", {
  id: bigint("id", { mode: "bigint" }).primaryKey(),
  type: text("type").notNull().default("group"),
  title: text("title").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const botMembers = pgTable("bot_members", {
  id: bigint("id", { mode: "bigint" }).primaryKey(),
  firstName: text("first_name").notNull().default(""),
  username: text("username"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const botGroupMembers = pgTable("bot_group_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  chatId: bigint("chat_id", { mode: "bigint" }).notNull().references(() => botGroups.id, { onDelete: "cascade" }),
  userId: bigint("user_id", { mode: "bigint" }).notNull().references(() => botMembers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique().on(t.chatId, t.userId)]);

export const botMessages = pgTable("bot_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  chatId: bigint("chat_id", { mode: "bigint" }).notNull().references(() => botGroups.id, { onDelete: "cascade" }),
  userId: bigint("user_id", { mode: "bigint" }).references(() => botMembers.id, { onDelete: "set null" }),
  senderName: text("sender_name").notNull().default(""),
  text: text("text").notNull().default(""),
  role: text("role").notNull().default("user"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const botStickers = pgTable("bot_stickers", {
  id: uuid("id").primaryKey().defaultRandom(),
  chatId: bigint("chat_id", { mode: "bigint" }).notNull().references(() => botGroups.id, { onDelete: "cascade" }),
  fileId: text("file_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [unique().on(t.chatId, t.fileId)]);

export const botActiveGames = pgTable("bot_active_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  chatId: bigint("chat_id", { mode: "bigint" }).notNull().references(() => botGroups.id, { onDelete: "cascade" }),
  messageId: bigint("message_id", { mode: "bigint" }).notNull(),
  gameType: text("game_type").notNull(),
  answer: text("answer").notNull().default(""),
  question: text("question").notNull().default(""),
  options: jsonb("options"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type BotGroup = typeof botGroups.$inferSelect;
export type BotMember = typeof botMembers.$inferSelect;
export type BotMessage = typeof botMessages.$inferSelect;
export type BotSticker = typeof botStickers.$inferSelect;
export type BotActiveGame = typeof botActiveGames.$inferSelect;
