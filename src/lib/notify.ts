import nodemailer from "nodemailer";
import { config, hasSmtp, hasTwilio } from "./config.ts";

export interface SendOutcome {
  ok: boolean;
  provider: string;
  detail: string;
}

export async function sendEmail(to: string, subject: string, body: string): Promise<SendOutcome> {
  if (!hasSmtp()) {
    return { ok: false, provider: "none", detail: "SMTP not configured (set SMTP_HOST and SMTP_FROM in .env)" };
  }
  try {
    const transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user && config.smtp.pass ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
    await transport.sendMail({ from: config.smtp.from, to, subject, text: body });
    return { ok: true, provider: `smtp:${config.smtp.host}`, detail: `sent to ${to}` };
  } catch (err) {
    return { ok: false, provider: `smtp:${config.smtp.host}`, detail: err instanceof Error ? err.message : "send failed" };
  }
}

export async function sendSms(to: string, body: string): Promise<SendOutcome> {
  if (!hasTwilio()) {
    return { ok: false, provider: "none", detail: "Twilio not configured (set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM in .env)" };
  }
  try {
    const auth = Buffer.from(`${config.twilio.sid}:${config.twilio.token}`).toString("base64");
    const params = new URLSearchParams({ To: to, From: config.twilio.from!, Body: body });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.sid}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
      signal: AbortSignal.timeout(15000),
    });
    return res.ok
      ? { ok: true, provider: "twilio", detail: `sent to ${to}` }
      : { ok: false, provider: "twilio", detail: `Twilio API error ${res.status}` };
  } catch (err) {
    return { ok: false, provider: "twilio", detail: err instanceof Error ? err.message : "send failed" };
  }
}

export function sendersConfigured(): { smtp: boolean; twilio: boolean } {
  return { smtp: hasSmtp(), twilio: hasTwilio() };
}
