import type { Request, Response } from "express";
import { Router } from "express";
import { searchLeads } from "../lib/leadgen.ts";
import { auditWebsite } from "../lib/audit.ts";
import { combinedScore, scoreLabel } from "../lib/score.ts";
import { buildSeoPack } from "../lib/seo.ts";
import { buildSite } from "../lib/builder.ts";
import { draftMessages, sendOutreach } from "../lib/responder.ts";
import { aiAvailable } from "../lib/ai.ts";
import { addLead, getLead, listLeads, saveStore, updateLead, type Lead } from "../lib/store.ts";
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
    apps: { chat: true, leadgen: true, audit: true, builder: true, seo: true, autoresponder: true },
    integrations: { mistral: aiFlag, googlePlaces: hasPlaces(), twilio: hasTwilio(), smtp: hasSmtp() },
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
  saveStore();
  res.json({ leadId: lead.id, seo, ai: aiFlag });
});

api.post("/site", async (req: Request, res: Response) => {
  const leadId = asString((req.body as Record<string, unknown>).leadId);
  if (!leadId) return bad(res, "Provide 'leadId'.");
  const lead = getLead(leadId);
  if (!lead) return bad(res, `Unknown leadId: ${leadId}`);

  const site = await buildSite(lead, lead.seo, lead.audit ?? null);
  const siteUrl = `/sites/${site.fileName}`;
  updateLead(lead.id, { siteUrl });
  saveStore();
  res.json({ leadId: lead.id, siteUrl, copySource: site.copySource });
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
