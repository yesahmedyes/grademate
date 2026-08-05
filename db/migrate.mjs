// Apply generated Drizzle migrations to Neon Postgres.
// Run with: pnpm db:migrate  (→ node --env-file=.env db/migrate.mjs)
//
// Uses the *unpooled* connection: DDL should bypass PgBouncer.
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

const url = process.env.NEON_DATABASE_URL_UNPOOLED;
if (!url) throw new Error("NEON_DATABASE_URL_UNPOOLED is not set");

const db = drizzle(neon(url));

await migrate(db, { migrationsFolder: "./drizzle" });
console.log(`✓ migrations applied to ${new URL(url).host}`);
