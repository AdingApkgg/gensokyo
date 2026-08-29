import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://thdl:thdl@localhost:5432/thdl";

declare global {
  var __thdl_pg: ReturnType<typeof postgres> | undefined;
}

const client = globalThis.__thdl_pg ?? postgres(connectionString, { max: 10 });
if (process.env.NODE_ENV !== "production") globalThis.__thdl_pg = client;

export const db = drizzle(client, { schema });
export * from "./schema";
