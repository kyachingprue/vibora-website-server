import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { CodeType, type User } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { ApiError } from "../../utils/ApiError";
import { generateCode, hashCode, hashToken, safeEqual } from "../../utils/crypto";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt";
import { sendPasswordResetEmail, sendVerificationEmail } from "../../lib/mailer";
import type { RegisterInput } from "./auth.schema";

const MAX_CODE_ATTEMPTS = 5;
const BCRYPT_ROUNDS = 12;
// Used so login takes the same time whether or not the email exists
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_ROUNDS);

/** Fields safe to send to the logged-in user (never includes passwordHash). */
export const privateUser = (u: User) => ({
  id: u.id,
  name: u.name,
  username: u.username,
  email: u.email,
  emailVerified: u.emailVerified,
  role: (u as User & { role?: string }).role || "USER",
  isActive: (u as User & { isActive?: boolean }).isActive ?? true,
  avatar: u.avatar,
  cover: u.cover,
  bio: u.bio,
  location: u.location,
  website: u.website,
  passion: (u as User & { passion?: string | null }).passion ?? null,
  relationshipStatus: (u as User & { relationshipStatus?: string | null }).relationshipStatus ?? null,
  createdAt: u.createdAt,
});

// ───────────────────────── verification codes ─────────────────────────

async function issueCode(user: User, type: CodeType) {
  // Cooldown: stop people from spamming the mail server
  const last = await prisma.verificationCode.findFirst({
    where: { userId: user.id, type },
    orderBy: { createdAt: "desc" },
  });
  if (last && Date.now() - last.createdAt.getTime() < env.CODE_RESEND_SECONDS * 1000) {
    throw ApiError.tooMany(`Please wait ${env.CODE_RESEND_SECONDS} seconds before requesting another code`);
  }

  const code = generateCode();
  await prisma.$transaction([
    prisma.verificationCode.deleteMany({ where: { userId: user.id, type } }),
    prisma.verificationCode.create({
      data: {
        userId: user.id,
        type,
        codeHash: hashCode(code),
        expiresAt: new Date(Date.now() + env.CODE_EXPIRES_MINUTES * 60_000),
      },
    }),
  ]);

  try {
    const mail = type === CodeType.EMAIL_VERIFICATION ? sendVerificationEmail : sendPasswordResetEmail;
    await mail(user.email, user.name, code);
  } catch (err) {
    console.error("Mail error:", err);
    throw new ApiError(502, "We could not send the email. Please try again later.", "MAIL_FAILED");
  }
}

async function consumeCode(userId: string, type: CodeType, code: string) {
  const record = await prisma.verificationCode.findFirst({
    where: { userId, type },
    orderBy: { createdAt: "desc" },
  });
  const invalid = ApiError.badRequest("Code is invalid or expired", "INVALID_CODE");

  if (!record || record.expiresAt < new Date()) throw invalid;
  if (record.attempts >= MAX_CODE_ATTEMPTS) throw ApiError.tooMany("Too many wrong attempts. Request a new code.");

  if (!safeEqual(record.codeHash, hashCode(code))) {
    await prisma.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    throw invalid;
  }
  await prisma.verificationCode.delete({ where: { id: record.id } });
}

// ───────────────────────── sessions (access + refresh tokens) ─────────────────────────

async function createSession(user: User, userAgent?: string) {
  const sid = randomUUID();
  const refreshToken = signRefreshToken(user.id, sid);

  await prisma.refreshToken.create({
    data: {
      id: sid,
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      userAgent: userAgent?.slice(0, 255),
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000),
    },
  });

  return { accessToken: signAccessToken(user.id), refreshToken, user: privateUser(user) };
}

// ───────────────────────── public API ─────────────────────────

export const authService = {
  async register(input: RegisterInput) {
    const [byEmail, byUsername] = await Promise.all([
      prisma.user.findUnique({ where: { email: input.email } }),
      prisma.user.findUnique({ where: { username: input.username } }),
    ]);

    if (byUsername && byUsername.id !== byEmail?.id) throw ApiError.conflict("Username is already taken");
    if (byEmail?.emailVerified) throw ApiError.conflict("An account with this email already exists");

    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
    const data = { name: input.name, username: input.username, passwordHash };

    // An unverified account with the same email is simply updated (user retrying sign-up)
    const user = byEmail
      ? await prisma.user.update({ where: { id: byEmail.id }, data })
      : await prisma.user.create({ data: { ...data, email: input.email } });

    await issueCode(user, CodeType.EMAIL_VERIFICATION);
  },

  async verifyEmail(email: string, code: string, userAgent?: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw ApiError.badRequest("Code is invalid or expired", "INVALID_CODE");
    if (user.emailVerified) throw ApiError.badRequest("Email is already verified", "ALREADY_VERIFIED");

    await consumeCode(user.id, CodeType.EMAIL_VERIFICATION, code);
    const verified = await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    return createSession(verified, userAgent); // log the user in right after verifying
  },

  async resendVerification(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    // Same response whether or not the account exists (no user enumeration)
    if (user && !user.emailVerified) await issueCode(user, CodeType.EMAIL_VERIFICATION);
  },

  async login(email: string, password: string, userAgent?: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw ApiError.unauthorized("Invalid email or password", "INVALID_CREDENTIALS");

    if (!user.emailVerified) {
      await issueCode(user, CodeType.EMAIL_VERIFICATION).catch(() => undefined); // cooldown may apply
      throw ApiError.forbidden("Please verify your email. We sent you a new code.", "EMAIL_NOT_VERIFIED");
    }
    return createSession(user, userAgent);
  },

  /** Rotates the refresh token. Re-using an old (revoked) token revokes ALL sessions of that user. */
  async refresh(token: string | undefined, userAgent?: string) {
    if (!token) throw ApiError.unauthorized("Refresh token missing", "NO_REFRESH_TOKEN");

    let payload: ReturnType<typeof verifyRefreshToken>;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      throw ApiError.unauthorized("Session expired, please log in again", "SESSION_EXPIRED");
    }

    const record = await prisma.refreshToken.findUnique({ where: { id: payload.sid }, include: { user: true } });
    if (!record || !safeEqual(record.tokenHash, hashToken(token)) || record.expiresAt < new Date()) {
      throw ApiError.unauthorized("Session expired, please log in again", "SESSION_EXPIRED");
    }
    if (record.revokedAt) {
      await prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw ApiError.unauthorized("Session expired, please log in again", "SESSION_EXPIRED");
    }

    await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
    return createSession(record.user, userAgent);
  },

  async logout(token: string | undefined) {
    if (!token) return;
    try {
      const { sid } = verifyRefreshToken(token);
      await prisma.refreshToken.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
    } catch {
      /* already invalid — nothing to revoke */
    }
  },

  async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (user?.emailVerified) await issueCode(user, CodeType.PASSWORD_RESET);
  },

  async resetPassword(email: string, code: string, newPassword: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw ApiError.badRequest("Code is invalid or expired", "INVALID_CODE");

    await consumeCode(user.id, CodeType.PASSWORD_RESET, code);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) } }),
      // Log the user out everywhere
      prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw ApiError.badRequest("Current password is incorrect", "WRONG_PASSWORD");
    }
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) } });
  },

  async me(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.unauthorized("Account no longer exists");
    return privateUser(user);
  },
};
