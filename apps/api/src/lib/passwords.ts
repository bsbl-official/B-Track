import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const KEY_LENGTH = 64;

export const MIN_PASSWORD_LENGTH = 8;

// Easy to read out or type: no 0/O, 1/l/I. 12 characters from 56 ≈ 69 bits.
const TEMPORARY_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateTemporaryPassword(length = 12): string {
  const bytes = randomBytes(length * 2);
  let result = "";
  // Rejection sampling keeps every character equally likely.
  for (const byte of bytes) {
    if (byte >= Math.floor(256 / TEMPORARY_ALPHABET.length) * TEMPORARY_ALPHABET.length) continue;
    result += TEMPORARY_ALPHABET[byte % TEMPORARY_ALPHABET.length];
    if (result.length === length) return result;
  }
  return result + generateTemporaryPassword(length - result.length);
}

// Stored as "scrypt$<salt>$<hash>", both base64.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}
