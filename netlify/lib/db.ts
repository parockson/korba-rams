import { neon } from "@neondatabase/serverless";
import { HttpError } from "./http";

let client: any;

function getClient() {
  if (!client) {
    const url = process.env.NETLIFY_DB_URL || process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
    if (!url) {
      throw new HttpError(
        500,
        "The database is not configured. Initialize Netlify Database and redeploy, or set NETLIFY_DB_URL.",
      );
    }
    client = neon(url);
  }
  return client;
}

/**
 * Run ONE parameterised SQL statement. Every business mutation in RAMS is a single statement
 * (data-modifying CTEs), which Postgres executes atomically - no partial submissions.
 * Cast bigint/numeric/date columns in SQL (::int, ::float8, ::text) so JSON stays predictable.
 */
export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const sql = getClient();
  const res = typeof sql.query === "function" ? await sql.query(text, params) : await sql(text, params);
  return res as T[];
}

export const one = async <T = any>(text: string, params: unknown[] = []): Promise<T | undefined> => (await q<T>(text, params))[0];
