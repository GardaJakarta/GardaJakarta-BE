import nodemailer from "nodemailer";

export const emailOtpEnabled = process.env.EMAIL_OTP_ENABLED === "true";
const smtpPort = Number(process.env.SMTP_PORT || 465);
export const mailConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const transport = mailConfigured ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: smtpPort,
  secure: smtpPort === 465,
  requireTLS: smtpPort !== 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
}) : null;

export async function sendRegistrationOtp(email: string, otp: string) {
  if (!transport) throw new Error("Email delivery is not configured.");
  await transport.sendMail({
    from: process.env.SMTP_FROM || "Garda Jakarta <laporpakemail@gmail.com>",
    to: email,
    subject: "Kode verifikasi akun Garda Jakarta",
    text: `Kode verifikasi Garda Jakarta: ${otp}. Berlaku selama 5 menit. Jangan bagikan kode ini kepada siapa pun. Jika kamu tidak meminta kode ini, abaikan email ini.`,
    html: `<div style="background:#f6f7f9;padding:32px 16px;font-family:sans-serif;color:#0f172a"><div style="max-width:480px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:32px"><p style="color:#e62428;font-weight:700">GARDA JAKARTA</p><h1 style="font-size:22px">Verifikasi email kamu</h1><p style="font-size:14px;line-height:1.7;color:#475569">Masukkan kode berikut untuk menyelesaikan verifikasi akun.</p><p style="font-size:32px;font-weight:700;letter-spacing:8px;background:#fff1f2;padding:20px;text-align:center;border-radius:12px">${otp}</p><p style="font-size:13px;line-height:1.7;color:#64748b">Berlaku selama 5 menit. Jangan bagikan kode ini kepada siapa pun. Jika kamu tidak meminta kode ini, abaikan email ini.</p></div></div>`,
  });
}
