import {sqliteTable,text,integer} from "drizzle-orm/sqlite-core";
export const accounts=sqliteTable("accounts",{id:text("id").primaryKey(),code:text("code").notNull().unique(),data:text("data").notNull(),revision:integer("revision").notNull().default(0)});
export const connections=sqliteTable("connections",{key:text("key").primaryKey(),a:text("a").notNull(),b:text("b").notNull(),sender:text("sender").notNull(),status:text("status").notNull()});
export const cache=sqliteTable("cache",{key:text("key").primaryKey(),data:text("data").notNull(),updated:integer("updated").notNull()});
export const movies=sqliteTable("movies",{id:text("id").primaryKey(),data:text("data").notNull()});
export const limits=sqliteTable("limits",{key:text("key").primaryKey(),count:integer("count").notNull(),expires:integer("expires").notNull()});
