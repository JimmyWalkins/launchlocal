import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");

export interface AuditCheck {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export interface Audit {
  url: string;
  reachable: boolean;
  responseMs: number;
  checks: AuditCheck[];
  score: number;
  recommendations: string[];
}

export interface SeoPack {
  metaTitle?: string;
  metaDescription?: string;
  keywords?: string[];
  postIdeas?: string[];
  improvements?: string[];
  source: "ai" | "heuristic";
}

export const CRM_STATUSES = ["new", "contacted", "qualified", "proposal", "won", "lost"] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];

export interface TimelineEvent {
  ts: string;
  event: string;
  detail: string;
}

export interface Lead {
  id: string;
  name: string;
  category: string;
  city: string;
  address?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviews?: number;
  score: number;
  status: CrmStatus;
  timeline: TimelineEvent[];
  source: "google" | "demo" | "manual";
  audit?: Audit;
  seo?: SeoPack;
  siteUrl?: string;
  outreach?: { channel: "email" | "sms"; to: string; sentAt: string; provider: string; ok: boolean; body: string }[];
  createdAt: string;
}

export interface Conversation {
  sessionId: string;
  leadId?: string;
  contact?: { email?: string; phone?: string };
  messages: { role: "user" | "assistant"; content: string; ts: string }[];
}

export interface KbConfig {
  offer?: string;
  brand?: string;
  faqs: { q: string; a: string }[];
}

export interface Store {
  leads: Record<string, Lead>;
  conversations: Record<string, Conversation>;
  kb: KbConfig;
}

let store: Store = { leads: {}, conversations: {}, kb: { faqs: [] } };

export function loadStore(): void {
  if (fs.existsSync(DATA_FILE)) {
    try {
      store = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as Store;
      if (!store.leads) store.leads = {};
      if (!store.conversations) store.conversations = {};
      if (!store.kb) store.kb = { faqs: [] };
    } catch {
      store = { leads: {}, conversations: {}, kb: { faqs: [] } };
    }
  } else {
    store = { leads: {}, conversations: {}, kb: { faqs: [] } };
  }
}

export function saveStore(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

export function listLeads(): Lead[] {
  return Object.values(store.leads).sort((a, b) => b.score - a.score);
}

export function getLead(id: string): Lead | undefined {
  return store.leads[id];
}

export function addLead(lead: Lead): Lead {
  const key = `${lead.name} ${lead.city} ${lead.category}`.toLowerCase();
  for (const existing of Object.values(store.leads)) {
    if (`${existing.name} ${existing.city} ${existing.category}`.toLowerCase() === key) {
      store.leads[existing.id] = { ...existing, ...lead, id: existing.id, audit: existing.audit, seo: existing.seo, siteUrl: existing.siteUrl, outreach: existing.outreach };
      return store.leads[existing.id];
    }
  }
  store.leads[lead.id] = lead;
  return lead;
}

export function updateLead(id: string, patch: Partial<Lead>): Lead | undefined {
  const lead = store.leads[id];
  if (!lead) return undefined;
  const next: Lead = { ...lead, status: lead.status, timeline: lead.timeline, ...patch };
  next.timeline = (next.timeline ?? []).slice(-50);
  store.leads[id] = next;
  return store.leads[id];
}

export function findLeadByPhone(phone: string): Lead | undefined {
  const digits = phone.replace(/\D/g, "").slice(-10);
  return Object.values(store.leads).find((l) => l.phone && l.phone.replace(/\D/g, "").slice(-10) === digits);
}

export function getConversation(sessionId: string): Conversation {
  if (!store.conversations[sessionId]) {
    store.conversations[sessionId] = { sessionId, messages: [] };
  }
  return store.conversations[sessionId];
}

export function saveConversation(sessionId: string, role: "user" | "assistant", content: string): void {
  const conv = getConversation(sessionId);
  conv.messages.push({ role, content, ts: new Date().toISOString() });
  if (conv.messages.length > 200) conv.messages = conv.messages.slice(-200);
}

export function getKb(): KbConfig {
  if (!store.kb.faqs.length) {
    store.kb.faqs = [
      { q: "What does Launch Local 661 do?", a: "We audit local businesses' online presence, then fix it: websites, local SEO, and outreach. Every engagement starts with a free automated audit and a plain-English plan." },
      { q: "How much does a website cost?", a: "Launch Pad one-page site is $497 flat (includes copy, hosting setup, schema, first SEO pass). A full 5-page site is $1,497." },
      { q: "What does SEO service include?", a: "SEO Care is $299/month: keyword plan, Google Business posts, on-page fixes, sitemap/schema, and a monthly progress report." },
      { q: "How fast can it be live?", a: "Most one-page sites are live within 7 days of the kickoff call." },
    ];
  }
  return store.kb;
}

export function setKb(patch: Partial<KbConfig>): KbConfig {
  const kb = getKb();
  if (patch.offer !== undefined) kb.offer = patch.offer;
  if (patch.brand !== undefined) kb.brand = patch.brand;
  if (Array.isArray(patch.faqs)) kb.faqs = patch.faqs;
  return kb;
}

export function listConversations(): Conversation[] {
  return Object.values(store.conversations);
}

export function resetStore(): void {
  store = { leads: {}, conversations: {}, kb: { faqs: [] } };
  if (fs.existsSync(DATA_FILE)) fs.rmSync(DATA_FILE);
}
