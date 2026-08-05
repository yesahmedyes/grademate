import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";

const url = process.env.NEON_DATABASE_URL;
if (!url) throw new Error("NEON_DATABASE_URL is not set");

// Pooled connection (the `-pooler` host). `neon()` is a stateless fetch wrapper over
// Neon's SQL-over-HTTP endpoint, so there's no client to cache across hot reloads.
const sql = neon(url);

export const db = drizzle(sql, { schema });
export { schema };
