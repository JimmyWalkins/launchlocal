import { getLead, saveStore, updateLead, type Lead } from "./store.ts";
import { sendSms } from "./notify.ts";

export function reviewLinkFor(lead: Lead): string {
  if (process.env.GOOGLE_REVIEW_URL?.trim()) return process.env.GOOGLE_REVIEW_URL.trim();
  return `https://www.google.com/search?q=${encodeURIComponent(`${lead.name} ${lead.city} reviews`)}`;
}

export async function sendReviewRequest(input: {
  leadId: string;
  customerPhone: string;
  customerName?: string;
  businessName?: string;
}): Promise<{ ok: boolean; link: string; sent: { ok: boolean; provider: string; detail: string } }> {
  const lead = getLead(input.leadId);
  if (!lead) throw new Error("unknown lead");
  const link = reviewLinkFor(lead);
  const businessName = input.businessName ?? lead.name;
  const who = input.customerName ? `Hi ${input.customerName}! ` : "Hi! ";
  const message = `${who}Thanks for choosing ${businessName}! Would you mind sharing your experience? It takes 30 seconds and helps us a ton: ${link} — Team ${businessName}`;

  const to = input.customerPhone.trim();
  const sent = await sendSms(to, message);
  updateLead(lead.id, {
    reviewLink: link,
    outreach: [...(lead.outreach ?? []), { channel: "sms", to, sentAt: new Date().toISOString(), provider: sent.provider, ok: sent.ok, body: message }],
    timeline: [...(lead.timeline ?? []), { ts: new Date().toISOString(), event: "review_request_sent", detail: `Review link sent to ${to} (${sent.provider})` }],
  });
  saveStore();
  return { ok: true, link, sent };
}
