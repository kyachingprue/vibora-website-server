import nodemailer from "nodemailer";
import { env } from "../config/env";

// 🔑 SMTP credentials (SMTP_HOST / SMTP_USER / SMTP_PASS) come from your .env via src/config/env.ts
const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE, // true for 465, false for 587 (STARTTLS)
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

type Mail = { to: string; subject: string; html: string; text: string };

async function send(mail: Mail) {
  if (!transporter) {
    // Development fallback: no SMTP configured -> print the email in the terminal
    console.log(`\n📧 [DEV EMAIL] to: ${mail.to}\n   subject: ${mail.subject}\n   ${mail.text}\n`);
    return;
  }
  await transporter.sendMail({ from: env.MAIL_FROM, ...mail });
}

const layout = (title: string, intro: string, code: string) => `
<div style="font-family:Inter,Arial,sans-serif;background:#f5f3ff;padding:32px 16px">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;text-align:center">
    <h2 style="margin:0 0 8px;color:#111827">${title}</h2>
    <p style="margin:0 0 24px;color:#4b5563;font-size:15px">${intro}</p>
    <div style="display:inline-block;letter-spacing:10px;font-size:34px;font-weight:800;color:#6d28d9;background:#ede9fe;border-radius:12px;padding:14px 22px">${code}</div>
    <p style="margin:24px 0 0;color:#6b7280;font-size:13px">This code expires in ${env.CODE_EXPIRES_MINUTES} minutes. If you didn't request it, you can safely ignore this email.</p>
  </div>
</div>`;

export const sendVerificationEmail = (to: string, name: string, code: string) =>
  send({
    to,
    subject: `${code} is your SocialHub verification code`,
    text: `Hi ${name}, your SocialHub verification code is ${code}. It expires in ${env.CODE_EXPIRES_MINUTES} minutes.`,
    html: layout("Verify your email", `Hi ${name}, enter this code to finish creating your SocialHub account.`, code),
  });

export const sendPasswordResetEmail = (to: string, name: string, code: string) =>
  send({
    to,
    subject: `${code} is your SocialHub password reset code`,
    text: `Hi ${name}, your SocialHub password reset code is ${code}. It expires in ${env.CODE_EXPIRES_MINUTES} minutes.`,
    html: layout("Reset your password", `Hi ${name}, use this code to choose a new password.`, code),
  });
