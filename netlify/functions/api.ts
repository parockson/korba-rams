import type { Config } from "@netlify/functions";
import { dispatch } from "../lib/router";
import { ensureReady } from "../lib/bootstrap";
import { HttpError, json } from "../lib/http";
import "../handlers/auth";
import "../handlers/admin";
import "../handlers/recon";
import "../handlers/search";
import "../handlers/exceptions";
import "../handlers/dashboard";
import "../handlers/audit";
import "../handlers/export";

export default async (req: Request): Promise<Response> => {
  try {
    await ensureReady();
    return await dispatch(req);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code, ...e.extra }, e.status);
    // never leak SQL or stack details to the browser
    console.error("RAMS API error:", e);
    return json({ error: "Something went wrong on the server. Please try again, or contact the administrator if it continues." }, 500);
  }
};

export const config: Config = { path: "/api/*" };
