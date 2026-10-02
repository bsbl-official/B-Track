import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

// The .env file lives at the repo root; this file runs from apps/api/{src,dist}/config.
config({ path: resolve(import.meta.dirname, "../../../../.env") });

const emailList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().url(),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  // OAuth client ID from Google Cloud Console. Google sign-in is off until it is set.
  GOOGLE_CLIENT_ID: z.string().optional().transform((value) => value || undefined),
  // Only these email domains may sign in (e.g. "brainstation-23.com"). Empty = any Google account.
  ALLOWED_EMAIL_DOMAINS: emailList,
  // These people get the Admin role the first time they sign in.
  ADMIN_EMAILS: emailList,
  // Signs short-lived sign-up tokens. Required in production; a random one is used locally if unset
  // (pending Google sign-ups then expire when the API restarts).
  AUTH_SECRET: z
    .string()
    .optional()
    .transform((value) => value || undefined)
    .refine((value) => !value || value.length >= 32, "AUTH_SECRET must be at least 32 characters"),
  // Local testing only: sign in by typing an email, no Google. Refused in production.
  DEV_LOGIN: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

// Hosts such as Render say which port to listen on through PORT.
const parsed = environmentSchema.parse({ ...process.env, API_PORT: process.env.API_PORT ?? process.env.PORT });

if (!parsed.AUTH_SECRET && parsed.NODE_ENV === "production") {
  throw new Error("AUTH_SECRET must be set in production");
}

export const env = { ...parsed, AUTH_SECRET: parsed.AUTH_SECRET ?? randomBytes(32).toString("hex") };

if (env.DEV_LOGIN && env.NODE_ENV === "production") {
  throw new Error("DEV_LOGIN must not be enabled in production");
}
