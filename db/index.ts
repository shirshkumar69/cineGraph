import { createClient } from "@libsql/client";

export function getDb() {
  if (!process.env.TURSO_DATABASE_URL) {
    // Return a dummy DB during build if vars are missing
    if (process.env.NODE_ENV === "production" && !process.env.TURSO_AUTH_TOKEN) {
      console.warn("Turso credentials missing. Please set TURSO_DATABASE_URL.");
    }
  }

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL || "file:local.db",
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  return {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        _sql_and_args: { sql, args },
        all: async () => {
          const res = await client.execute({ sql, args });
          return { results: res.rows };
        },
        first: async () => {
          const res = await client.execute({ sql, args });
          return res.rows[0] || null;
        },
        run: async () => {
          const res = await client.execute({ sql, args });
          return { meta: { changes: res.rowsAffected } };
        }
      })
    }),
    batch: async (statements: any[]) => {
      const stmts = statements.map(s => s._sql_and_args);
      return client.batch(stmts);
    }
  };
}
