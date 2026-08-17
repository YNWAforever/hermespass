import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import ws from "ws";

import { schema } from "@/db/schema";
import { databaseUrl } from "@/lib/env";

neonConfig.webSocketConstructor = ws;

type Database = NeonDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

let pool: Pool | undefined;
let database: Database | undefined;

function getPool(): Pool {
  pool ??= new Pool({ connectionString: databaseUrl(), max: 3 });
  return pool;
}

export function getDb(): Database {
  database ??= drizzle(getPool(), { schema });
  return database;
}

export async function withUserTransaction<T>(
  userId: string,
  callback: (tx: Transaction) => Promise<T>,
) {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('hermes.user_id', ${userId}, true)`);
    return callback(tx);
  });
}

export async function withPublicDatabase<T>(callback: (db: Database) => Promise<T>): Promise<T> {
  return callback(getDb());
}

export type { Database, Transaction };
