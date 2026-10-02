// A short-lived, signed note of a verified Google identity. The sign-up form sends it back
// with the chosen name and password, so the email can't be swapped in between.
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

export type GoogleIdentity = {
  email: string;
  firstName: string;
  lastName: string;
  googleId?: string;
  avatarUrl?: string;
};

const TTL_MS = 30 * 60 * 1000;
const sign = (payload: string) => createHmac("sha256", env.AUTH_SECRET).update(payload).digest("base64url");

export function createSignupToken(identity: GoogleIdentity): string {
  const payload = Buffer.from(JSON.stringify({ ...identity, expiresAt: Date.now() + TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSignupToken(token: string): GoogleIdentity | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const { expiresAt, ...identity } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  return typeof expiresAt === "number" && expiresAt > Date.now() ? (identity as GoogleIdentity) : null;
}
