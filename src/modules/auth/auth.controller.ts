import type { CookieOptions, Request, RequestHandler, Response } from "express";
import { env } from "../../config/env";
import { message, ok, userId } from "../../utils/response";
import { authService } from "./auth.service";

const COOKIE_NAME = "refreshToken";

// httpOnly: JavaScript in the browser can never read the refresh token.
// Production: SameSite=None + Secure so a frontend on another domain can use it.
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.isProd,
  sameSite: env.isProd ? "none" : "lax",
  path: "/api/auth", // sent only to auth routes
};

const setRefreshCookie = (res: Response, token: string) =>
  res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: env.REFRESH_TOKEN_DAYS * 86_400_000 });

const sendSession = (res: Response, session: { accessToken: string; refreshToken: string; user: unknown }) => {
  setRefreshCookie(res, session.refreshToken);
  return ok(res, { accessToken: session.accessToken, user: session.user });
};

const agent = (req: Request) => req.get("user-agent");

export const register: RequestHandler = async (req, res) => {
  await authService.register(req.body);
  message(res, "Account created. We sent a 6-digit code to your email.", 201);
};

export const verifyEmail: RequestHandler = async (req, res) => {
  sendSession(res, await authService.verifyEmail(req.body.email, req.body.code, agent(req)));
};

export const resendCode: RequestHandler = async (req, res) => {
  await authService.resendVerification(req.body.email);
  message(res, "If the account exists and is not verified, a new code was sent.");
};

export const login: RequestHandler = async (req, res) => {
  sendSession(res, await authService.login(req.body.email, req.body.password, agent(req)));
};

export const refresh: RequestHandler = async (req, res) => {
  try {
    sendSession(res, await authService.refresh(req.cookies?.[COOKIE_NAME], agent(req)));
  } catch (err) {
    res.clearCookie(COOKIE_NAME, cookieOptions);
    throw err;
  }
};

export const logout: RequestHandler = async (req, res) => {
  await authService.logout(req.cookies?.[COOKIE_NAME]);
  res.clearCookie(COOKIE_NAME, cookieOptions);
  message(res, "Logged out");
};

export const forgotPassword: RequestHandler = async (req, res) => {
  await authService.forgotPassword(req.body.email);
  message(res, "If an account exists for this email, a reset code was sent.");
};

export const resetPassword: RequestHandler = async (req, res) => {
  await authService.resetPassword(req.body.email, req.body.code, req.body.newPassword);
  message(res, "Password updated. Please log in with your new password.");
};

export const changePassword: RequestHandler = async (req, res) => {
  await authService.changePassword(userId(req), req.body.currentPassword, req.body.newPassword);
  message(res, "Password changed");
};

export const me: RequestHandler = async (req, res) => {
  ok(res, await authService.me(userId(req)));
};
