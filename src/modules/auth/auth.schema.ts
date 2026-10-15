import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email"));
const code = z.string().trim().regex(/^\d{6}$/, "Code must be 6 digits");
const password = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password is too long")
  .regex(/[A-Za-z]/, "Password needs at least one letter")
  .regex(/\d/, "Password needs at least one number");

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Name is too short").max(50),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_]{3,20}$/, "Username: 3-20 letters, numbers or underscores"),
  email,
  password,
});

export const verifyEmailSchema = z.object({ email, code });
export const emailOnlySchema = z.object({ email });
export const loginSchema = z.object({ email, password: z.string().min(1, "Password is required") });
export const resetPasswordSchema = z.object({ email, code, newPassword: password });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: password });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
