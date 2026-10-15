import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

/** Random 6-digit code, e.g. "042917" */
export const generateCode = () => randomInt(0, 1_000_000).toString().padStart(6, "0");

/** Codes are stored hashed (HMAC) so a database leak does not reveal them. */
export const hashCode = (code: string) =>
  createHmac("sha256", env.JWT_ACCESS_SECRET).update(code).digest("hex");

export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Refresh tokens are stored as SHA-256 hashes. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
