import { rateLimit } from "express-rate-limit";

const base = {
  standardHeaders: "draft-8" as const,
  legacyHeaders: false,
};

/** Applied to the whole API */
export const apiLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 600,
  message: { success: false, code: "TOO_MANY_REQUESTS", message: "Too many requests, slow down." },
});

/** Stricter limit for login / register / code endpoints (brute-force protection) */
export const authLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: { success: false, code: "TOO_MANY_REQUESTS", message: "Too many attempts, try again in a few minutes." },
});

/** Video signature requests: each one allows a large upload, so keep it tight */
export const uploadLimiter = rateLimit({
  ...base,
  windowMs: 60 * 60 * 1000,
  limit: 30,
  message: { success: false, code: "TOO_MANY_REQUESTS", message: "Too many upload requests, try again later." },
});
