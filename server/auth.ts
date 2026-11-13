import type { RequestHandler, Response } from "express";
import { createServerClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are not set. Copy .env.example to .env and fill in the Supabase values.");

/** What the page needs to reach Supabase's sign-in service. Both values are meant to be public. */
export const authConfig = { supabaseUrl: url, supabaseKey: key };

/**
 * Lets a request through only if it comes from a signed-in user, and remembers who that is.
 * The page signs in with Supabase directly; the session then travels to us in cookies on every request.
 */
export const requireUser: RequestHandler = async (req, res, next) => {
  const supabase = createServerClient(url, key, {
    cookieOptions: { secure: process.env.NODE_ENV === "production" },
    cookies: {
      getAll: () => parseCookieHeader(req.headers.cookie ?? "").map(({ name, value }) => ({ name, value: value ?? "" })),
      // A session that is about to expire is renewed here, and the new cookies go back with the response.
      setAll: (cookies, headers) => {
        if (res.headersSent) return;
        for (const { name, value, options } of cookies) res.appendHeader("Set-Cookie", serializeCookieHeader(name, value, options));
        for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
      },
    },
  });
  // Checks the token's signature against Supabase's keys. What the cookie claims is never trusted as it is.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return res.status(401).json({ error: "Not signed in" });
  res.locals.userId = userId;
  next();
};

/** The signed-in user's id. Only valid on routes behind requireUser. */
export const userOf = (res: Response): string => res.locals.userId;
