import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { authLimiter } from "../../middleware/rateLimit";
import { validate } from "../../middleware/validate";
import * as c from "./auth.controller";
import {
  changePasswordSchema,
  emailOnlySchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./auth.schema";

const router = Router();

router.post("/register", authLimiter, validate({ body: registerSchema }), c.register);
router.post("/verify-email", authLimiter, validate({ body: verifyEmailSchema }), c.verifyEmail);
router.post("/resend-code", authLimiter, validate({ body: emailOnlySchema }), c.resendCode);
router.post("/login", authLimiter, validate({ body: loginSchema }), c.login);
router.post("/refresh", c.refresh);
router.post("/logout", c.logout);

router.post("/forgot-password", authLimiter, validate({ body: emailOnlySchema }), c.forgotPassword);
router.post("/reset-password", authLimiter, validate({ body: resetPasswordSchema }), c.resetPassword);
router.post("/change-password", requireAuth, validate({ body: changePasswordSchema }), c.changePassword);

router.get("/me", requireAuth, c.me);

export default router;
