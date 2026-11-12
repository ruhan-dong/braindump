import type { RequestHandler, Response } from "express";
import { sql } from "./db.ts";

// TEMPORARY, until login is built: every request is treated as the first user in the Supabase project.
const [devUser] = await sql<{ id: string }[]>`SELECT id FROM auth.users ORDER BY created_at LIMIT 1`;
if (!devUser) throw new Error("No users yet. Add one in the Supabase dashboard: Authentication > Users > Add user.");

/** Works out who is asking and remembers it for the rest of the request. */
export const requireUser: RequestHandler = (_req, res, next) => {
  res.locals.userId = devUser.id;
  next();
};

/** The signed-in user's id. Only valid on routes behind requireUser. */
export const userOf = (res: Response): string => res.locals.userId;
