import type { Request, Response } from "express";
import { Router } from "express";
import { searchLeads } from "../lib/leadgen.ts";
import { auditWebsite } from "../lib/audit.ts";
import { combinedScore, scoreLabel } from "../lib/score.ts";
import { buildSeoPack } from "../lib/seo.ts";
import { buildSite } from "../lib/builder.ts";
import { draftMessages, sendOutreach } from "../lib/responder.ts";
import { sendEmail, sendSms } from "../lib/notify.ts";
import { runAgent } from "../lib/agent.ts";
import { listTemplates } from "../lib/templates.ts";
import { ingestAudit, knowledgeStats, reindexAll } from "../lib/kb.ts";
import { bookingLink, calendarProvider } from "../lib/calendar.ts";
import { paymentsConfigured } from "../lib/payments.ts";
import { embeddingsAvailable } from "../lib/embed.ts";
import { aiAvailable } from "../lib/ai.ts";
import {
  addLead,
  findLeadByPhone,
  getConversation,
  getLead,
  getKb,
  listConversations,
  listEnrollments,
  listLeads,
  saveStore,
  setKb,
  updateLead,
  type Lead,
} from "../lib/store.ts";
import { SEQUENCES, enrollLead, tickSequences } from "../lib/sequences.ts";
import { hasPlaces, hasSmtp, hasTwilio } from "../lib/config.ts";

export const api = Router();
const aiFlag = aiAvailable();

function bad(res: Response, error: string): void {
  res.status(400).json({ error });
}

const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const asNumber = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

api.get("/status", (_req, res) => {
  res.json({
    apps: { chat: true, leadgen: true, audit: true, builder: true, seo: true, autoresponder: true, salesAgent: true, sequences: true, stripeWebhook: true },
    integrations: {
      mistral: aiFlag,
      googlePlaces: hasPlaces(),
      twilio: hasTwilio(),
      smtp: hasSmtp(),
      stripe: paymentsConfigured(),
      calendar: calendarProvider(),
      embeddings: embeddingsAvailable(),
    },
    knowledge: knowledgeStats(),
  });
});

api.post("/leads/search", async (req: Request, res: Response) => {
  const category = asString((req.body as Record<string, unknown>).category);
  const city = asString((req.body as Record<string, unknown>).city);
  const limit = asNumber((req.body as Record<string, unknown>).limit);
  if (!category) return bad(res, "Provide a 'category' (e.g. plumber, dentist, restaurant).");
  if (!city) return bad(res, "Provide a 'city' (e.g. Bakersfield).");

  try {
    const { leads, source } = await searchLeads({ category, city, limit: limit ?? 10 });
    leads.forEach(addLead);
    saveStore();
    res.json({ source, leads });
  } catch (err) {
    res.status(502).json({ error: `Lead search failed: ${err instanceof Error ? err.message : "unknown error"}` });
  }
});

api.get("/leads", (_req, res) => {
  res.json({ leads: listLeads() });
});

api.post("/audit", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const leadId = asString(body.leadId);
  const url = asString(body.url);
  if (!leadId && !url) return bad(res, "Provide 'leadId' or 'url'.");

  let lead: Lead | undefined;
  let target = url;
  if (leadId) {
    lead = getLead(leadId);
    if (!lead) return bad(res, `Unknown leadId: ${leadId}`);
    if (lead.website) target = lead.website;
  }
  if (!target) return bad(res, "This lead has no website — currently audits need a URL.");

  try {
    const audit = await auditWebsite(target);
    if (lead) {
      const score = combinedScore(lead, audit);
      updateLead(lead.id, { audit, score });
      await ingestAudit(lead.id, lead.name, audit);
      saveStore();
      res.json({ leadId: lead.id, audit, score, label: scoreLabel(score) });
    } else {
      const score = combinedScore({ website: target }, audit);
      res.json({ leadId: null, audit, score, label: scoreLabel(score) });
    }
  } catch (err) {
    res.status(500).json({ error: `Audit failed: ${err instanceof Error ? err.message : "unknown error"}` });
  }
});

api.post("/seo", async (req: Request, res: Response) => {
  const leadId = asString((req.body as Record<string, unknown>).leadId);
  if (!leadId) return bad(res, "Provide 'leadId'.");
  const lead = getLead(leadId);
  if (!lead) return bad(res, `Unknown leadId: ${leadId}`);

  const audit = lead.audit ?? (lead.website ? await auditWebsite(lead.website) : null);
  const seo = await buildSeoPack(lead, audit);
  updateLead(lead.id, { seo, ...(audit && !lead.audit ? { audit, score: combinedScore(lead, audit) } : {}) });
  if (audit && !lead.audit) await ingestAudit(lead.id, lead.name, audit);
  saveStore();
  res.json({ leadId: lead.id, seo, ai: aiFlag });
});

api.get("/templates", (_req, res) => {
  res.json({ templates: listTemplates() });
});

api.post("/site", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const leadId = asString(body.leadId);
  if (!leadId) return bad(res, "Provide 'leadId'.");
  const lead = getLead(leadId);
  if (!lead) return bad(res, `Unknown leadId: ${leadId}`);
  const templateHint = asString(body.template) || undefined;
  if (templateHint && !listTemplates().some((t) => t.id === templateHint.toLowerCase())) {
    return bad(res, `Unknown template '${templateHint}'. Available: ${listTemplates().map((t) => t.id).join(", ")} (omit to auto-match business type).`);
  }

  const site = await buildSite(lead, lead.seo, lead.audit ?? null, templateHint);
  const siteUrl = `/sites/${site.fileName}`;
  updateLead(lead.id, { siteUrl });
  saveStore();
  res.json({ leadId: lead.id, siteUrl, copySource: site.copySource, template: site.template });
});

api.post("/responder", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const leadId = asString(body.leadId);
  if (!leadId) return bad(res, "Provide 'leadId'.");
  const lead = getLead(leadId);
  if (!lead) return bad(res, `Unknown leadId: ${leadId}`);

  const draft = draftMessages(lead, lead.audit ?? null);
  const channels = { email: asString(body.email) || undefined, sms: asString(body.sms) || undefined };

  if (!channels.email && !channels.sms) {
    res.json({ mode: "preview", draft, sent: null });
    return;
  }

  const sent = await sendOutreach(lead, draft, channels);
  const entries = [
    channels.email && sent.email
      ? { channel: "email" as const, to: channels.email, sentAt: new Date().toISOString(), provider: sent.email.provider, ok: sent.email.ok, body: draft.email.body }
      : null,
    channels.sms && sent.sms
      ? { channel: "sms" as const, to: channels.sms, sentAt: new Date().toISOString(), provider: sent.sms.provider, ok: sent.sms.ok, body: draft.sms.body }
      : null,
  ].filter((e): e is NonNullable<Lead["outreach"]>[number] => e !== null);

  updateLead(lead.id, { outreach: [...(lead.outreach ?? []), ...entries] });
  saveStore();
  res.json({ mode: "sent", draft, sent });
});

api.post("/kb", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const offer = asString(body.offer);
  const brand = asString(body.brand);
  const faqs = Array.isArray(body.faqs)
    ? (body.faqs as { q?: unknown; a?: unknown }[]).map((f) => ({ q: String(f.q ?? ""), a: String(f.a ?? "") })).filter((f) => f.q && f.a)
    : undefined;
  getKb();
  setKb({ ...(offer ? { offer } : {}), ...(brand ? { brand } : {}), ...(faqs ? { faqs } : {}) });
  await reindexAll();
  saveStore();
  res.json({ ok: true, kb: getKb(), knowledge: knowledgeStats() });
});

function findLeadByEmail(email: string): Lead | undefined {
  const target = email.toLowerCase().trim();
  return listLeads().find((l) => {
    const emails = l.outreach?.filter((o) => o.channel === "email" && o.ok).map((o) => o.to.toLowerCase()) ?? [];
    return emails.includes(target);
  });
}

api.post("/agent", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const message = asString(body.message);
  if (!message) return bad(res, "Provide 'message'.");

  const sessionId = asString(body.sessionId) || `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const contact = {
    email: asString((body.contact as Record<string, unknown> | undefined)?.email) || undefined,
    phone: asString((body.contact as Record<string, unknown> | undefined)?.phone) || undefined,
  };

  const conv = getConversation(sessionId);
  const result = await runAgent({
    sessionId,
    message,
    leadId: asString(body.leadId) || conv.leadId,
    contact,
    channel: "web",
    history: conv.messages.map((m) => ({ role: m.role, content: m.content })),
  });
  res.json(result);
});

api.post("/agent/email", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const rawText = asString(body.text) || asString(body.body);
  const from = asString(body.from) || undefined;
  if (!rawText) return bad(res, "Provide 'text' (the inbound email body).");
  let leadId = asString(body.leadId) || undefined;
  if (!leadId && from) leadId = findLeadByEmail(from)?.id;
  if (!leadId) return bad(res, "Provide 'leadId' or a 'from' address matching a lead that received an email.");

  const sessionId = `email-${leadId}`;
  const conv = getConversation(sessionId);
  const result = await runAgent({
    sessionId,
    message: rawText,
    leadId,
    contact: { email: from },
    channel: "email",
    history: conv.messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const lead = getLead(leadId)!;
  const storedEmails = lead.outreach?.filter((o) => o.channel === "email" && o.ok).map((o) => o.to) ?? [];
  const to = asString(body.to) || (from && from.includes("@") ? from : storedEmails[0]);
  let sent: Awaited<ReturnType<typeof sendEmail>> | null = null;
  if (to) {
    sent = await sendEmail(to, `Re: ${lead.name} — Launch Local 661`, result.reply);
    updateLead(leadId, {
      outreach: [...(lead.outreach ?? []), { channel: "email", to, sentAt: new Date().toISOString(), provider: sent.provider, ok: sent.ok, body: result.reply }],
    });
  }
  saveStore();
  res.json({ ok: true, sessionId, engine: result.engine, toolsUsed: result.toolsUsed, reply: result.reply, sent, sentTo: to ?? null });
});

api.post("/agent/sms", async (req: Request, res: Response) => {
  const body: Record<string, unknown> = { ...((req.query ?? {}) as Record<string, unknown>), ...((req.body ?? {}) as Record<string, unknown>) };
  const rawText = asString(body.Body) || asString(body.text) || asString(body.body);
  const from = asString(body.From) || asString(body.from) || asString(body.sms);
  if (!rawText) return bad(res, "Provide 'text' (or Twilio form-encoded 'Body').");
  if (/\b(?:stop|unsubscribe)\b/i.test(rawText)) {
    const isTwilio = String(req.headers["content-type"] ?? "").includes("x-www-form-urlencoded");
    if (isTwilio) {
      res.type("text/xml").send("<Response><Message>You are unsubscribed. No further messages.</Message></Response>");
      return;
    }
    res.json({ ok: true, reply: "You are unsubscribed. No further messages." });
    return;
  }

  const lead = !asString(body.leadId) && from ? findLeadByPhone(from) : undefined;
  const leadId = asString(body.leadId) || lead?.id;
  if (!leadId) return bad(res, "Provide 'leadId' (or a phone number matching a known lead).");

  const sessionId = `sms-${leadId}`;
  const conv = getConversation(sessionId);
  const result = await runAgent({
    sessionId,
    message: rawText,
    leadId,
    contact: { phone: from || lead?.phone },
    channel: "sms",
    history: conv.messages.map((m) => ({ role: m.role, content: m.content })),
  });

  const leadNow = getLead(leadId)!;
  const to = from || leadNow.phone;
  let sent: Awaited<ReturnType<typeof sendSms>> | null = null;
  if (to) {
    sent = await sendSms(to, result.reply.slice(0, 300));
    updateLead(leadId, {
      outreach: [...(leadNow.outreach ?? []), { channel: "sms", to, sentAt: new Date().toISOString(), provider: sent.provider, ok: sent.ok, body: result.reply }],
    });
  }
  saveStore();

  const isTwilio = String(req.headers["content-type"] ?? "").includes("x-www-form-urlencoded");
  if (isTwilio) {
    res.type("text/xml").send(`<Response><Message>${result.reply.replace(/[<>&]/g, "")}</Message></Response>`);
    return;
  }
  res.json({ ok: true, sessionId, engine: result.engine, toolsUsed: result.toolsUsed, reply: result.reply, sent, sentTo: to ?? null });
});

api.post("/sequences/enroll", async (req: Request, res: Response) => {
  const leadId = asString(req.body?.leadId);
  if (!leadId) return bad(res, "Provide 'leadId'.");
  const seqName = asString(req.body?.seqName) || "standard";
  const result = enrollLead(leadId, seqName);
  if (!result.ok) return bad(res, result.error);
  res.json({ ok: true, enrollment: result.enrollment, available: Object.keys(SEQUENCES) });
});

api.get("/sequences", (_req, res) => {
  res.json({
    available: Object.keys(SEQUENCES).map((name) => ({
      name,
      steps: SEQUENCES[name].map((s) => ({ day: s.day, channel: s.channel, label: s.label })),
    })),
    enrollments: listEnrollments(),
  });
});

api.post("/sequences/tick", async (_req, res) => {
  const result = await tickSequences();
  res.json({ ok: true, ...result });
});

api.get("/conversations", (_req, res) => {
  res.json({
    conversations: listConversations().map((c) => ({
      sessionId: c.sessionId,
      leadId: c.leadId,
      contact: c.contact,
      count: c.messages.length,
      last: c.messages.at(-1),
    })),
  });
});
