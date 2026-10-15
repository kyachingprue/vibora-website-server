import type { Request, RequestHandler } from "express";
import { ApiError } from "../utils/ApiError";
import { verifyAccessToken } from "../utils/jwt";
import { prisma } from "../config/prisma";

const bearerToken = (req: Request) => {
  const header = req.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
};

/** Route needs a logged-in user. Expects `Authorization: Bearer <accessToken>`. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw ApiError.unauthorized();

  try {
    req.user = { id: verifyAccessToken(token).sub };
  } catch {
    throw ApiError.unauthorized("Access token is invalid or expired", "TOKEN_EXPIRED");
  }
  const authenticatedId = req.user.id;
  const user = await prisma.user.findUnique({ where: { id: authenticatedId }, select: { isActive: true } });
  if (!user || !user.isActive) throw ApiError.forbidden("This account is inactive");
  next();
};

/** Public route that returns extra info (liked, following…) when a valid token is sent. */
export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = bearerToken(req);
  if (token) {
    try {
      req.user = { id: verifyAccessToken(token).sub };
    } catch {
      /* treat as anonymous */
    }
  }
  next();
};

/** Server-side admin authorization; never trust the role sent by the browser. */
export const requireAdmin: RequestHandler = async (req, _res, next) => {
  const token = bearerToken(req);
  if (!token) throw ApiError.unauthorized();
  let id: string;
  try { id = verifyAccessToken(token).sub; } catch { throw ApiError.unauthorized("Access token is invalid or expired", "TOKEN_EXPIRED"); }
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true } });
  if (!user || !user.isActive) throw ApiError.forbidden("This account is inactive");
  if (user.role.toLowerCase() !== "admin" && user.role.toLowerCase() !== "administrator") throw ApiError.forbidden("Administrator access required");
  req.user = { id };
  next();
};
