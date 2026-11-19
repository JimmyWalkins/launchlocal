import { sendEmail, sendSms, type SendOutcome } from "./notify.ts";
import type { Audit, Lead } from "./store.ts";

export interface Draft {
  email: { subject: string; body: string };
  sms: { to?: string; body: string };
}

export function draftMessages(lead: Lead, audit?: Audit | null): Draft {
  const issues =
    audit?.reachable === true
      ? audit.recommendations.slice(0, 2).join("; ")
      : audit
        ? "your site was unreachable when we checked"
        : "your online presence";
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
  email?: SendOutcome;
  sms?: SendOutcome;
}

export async function sendOutreach(lead: Lead, draft: Draft, channels: { email?: string; sms?: string }): Promise<SendResult> {
  const result: SendResult = {};
  if (channels.email) {
    result.email = await sendEmail(channels.email, draft.email.subject, draft.email.body);
  }
  if (channels.sms) {
    result.sms = await sendSms(channels.sms, draft.sms.body);
  }
  return result;
}
