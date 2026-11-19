import nodemailer from "nodemailer";
import { config, hasSmtp, hasTwilio } from "./config.ts";
import type { Audit, Lead } from "./store.ts";

export interface Draft {
  email: { to?: string; subject: string; body: string };
  sms: { to?: string; body: string };
}

export function draftMessages(lead: Lead, audit?: Audit | null): Draft {
  const issues = audit?.reachable === true ? audit.recommendations.slice(0, 2).join("; ") : audit ? "your site was unreachable when we checked" : "your online presence";
  const siteLink = lead.siteUrl ? ` We even mocked up a free preview: ${lead.siteUrl}` : "";
  const email = {
    subject: `Quick note about ${lead.name}'s online presence`,
    body:
      `Hi ${lead.name} team,\n\n` +
      `I was looking at local ${lead.category}s in ${lead.city} and checked out your online presence. ` +
      `The biggest gaps I found right now: ${issues}.${siteLink}\n\n` +
      `We're a local team that fixes exactly these issues — usually within a week, for a flat fee. ` +
      `Want me to send over the full audit + a plan to pull ahead of nearby competitors?\n\n` +
      `— Jimmy, Launch Local 661`,
  };
  const sms = {
    to: lead.phone,
    body: `Hi ${lead.name}! Checked your site/SEO today: ${issues.slice(0, 60)}.${siteLink} Reply YES for the free full audit. STOP to opt out.`,
  };
  return { email, sms };
}

export interface SendResult {
  email?: { ok: boolean; provider: string; detail: string };
  sms?: { ok: boolean; provider: string; detail: string };
}

export async function sendOutreach(lead: Lead, draft: Draft, channels: { email?: string; sms?: string }): Promise<SendResult> {
  const result: SendResult = {};
  const emailTo = channels.email;
  if (emailTo) {
    if (!hasSmtp()) {
      result.email = { ok: false, provider: "none", detail: "SMTP not configured (set SMTP_HOST and SMTP_FROM in .env)" };
    } else {
      try {
        const transport = nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.port === 465,
          auth: config.smtp.user && config.smtp.pass ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
        });
        await transport.sendMail({
          from: config.smtp.from,
          to: emailTo,
          subject: draft.email.subject,
          text: draft.email.body,
        });
        result.email = { ok: true, provider: `smtp:${config.smtp.host}`, detail: `sent to ${emailTo}` };
      } catch (err) {
        result.email = { ok: false, provider: `smtp:${config.smtp.host}`, detail: err instanceof Error ? err.message : "send failed" };
      }
    }
  }

  const smsTo = channels.sms;
  if (smsTo) {
    if (!hasTwilio()) {
      result.sms = { ok: false, provider: "none", detail: "Twilio not configured (set TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM in .env)" };
    } else {
      try {
        const auth = Buffer.from(`${config.twilio.sid}:${config.twilio.token}`).toString("base64");
        const body = new URLSearchParams({ To: smsTo, From: config.twilio.from!, Body: draft.sms.body });
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.sid}/Messages.json`, {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(15000),
        });
        result.sms = res.ok
          ? { ok: true, provider: "twilio", detail: `sent to ${smsTo}` }
          : { ok: false, provider: "twilio", detail: `Twilio API error ${res.status}` };
      } catch (err) {
        result.sms = { ok: false, provider: "twilio", detail: err instanceof Error ? err.message : "send failed" };
      }
    }
  }
  return result;
}
