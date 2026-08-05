import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` only reads the schema to emit SQL (no DB connection), but
// `drizzle-kit studio` does connect — hence dbCredentials. Migrations are applied via
// `db/migrate.mjs`. Both use the unpooled URL: DDL and studio sessions bypass PgBouncer.
//
// Note: drizzle-kit does not load .env itself, so run its commands through
// `node --env-file=.env` (see the db:* scripts in package.json).
export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.NEON_DATABASE_URL_UNPOOLED!,
  },
});
