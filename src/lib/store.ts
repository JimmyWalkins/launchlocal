import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_FILE = path.join(DATA_DIR, "launchlocal.db");
const LEGACY_FILE = path.join(DATA_DIR, "store.json");

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

export interface GbpPack {
  checklist: string[];
  postIdeas: string[];
  photoIdeas: string[];
  categories?: string[];
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
  gbp?: GbpPack;
  lastReportAt?: string;
  reviewLink?: string;
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

export interface SequenceStepState {
  day: number;
  channel: "email" | "sms";
  label: string;
  status: "pending" | "sent" | "skipped";
  dueAt: string;
  sentAt?: string;
  detail?: string;
}

export interface Enrollment {
  id: string;
  leadId: string;
  seqName: string;
  status: "active" | "done" | "stopped";
  enrolledAt: string;
  steps: SequenceStepState[];
}

export interface Store {
  leads: Record<string, Lead>;
  conversations: Record<string, Conversation>;
  enrollments: Enrollment[];
  kb: KbConfig;
}

let store: Store = emptyStore();
let db: DatabaseSync | null = null;

function emptyStore(): Store {
  return { leads: {}, conversations: {}, enrollments: [], kb: { faqs: [] } };
}

function normalize(raw: Partial<Store> | null): Store {
  const out = emptyStore();
  if (!raw) return out;
  if (raw.leads && typeof raw.leads === "object") out.leads = raw.leads;
  if (raw.conversations && typeof raw.conversations === "object") out.conversations = raw.conversations;
  if (Array.isArray(raw.enrollments)) out.enrollments = raw.enrollments;
  if (raw.kb && typeof raw.kb === "object") out.kb = { ...raw.kb, faqs: raw.kb.faqs ?? [] };
  return out;
}

function openDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec("CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, data TEXT NOT NULL)");
  return db;
}

export function loadStore(): void {
  const database = openDb();
  const leadRows = database.prepare("SELECT data FROM leads").all() as { data?: string }[];
  const kvRows = database.prepare("SELECT key, data FROM kv").all() as { key?: string; data?: string }[];
  if (!leadRows.length && !kvRows.length && fs.existsSync(LEGACY_FILE)) {
    try {
      store = normalize(JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8")) as Partial<Store>);
    } catch {
      store = emptyStore();
    }
    saveStore();
    return;
  }
  store = emptyStore();
  for (const row of leadRows) {
    try {
      const lead = JSON.parse(row.data ?? "") as Lead;
      if (lead && lead.id) store.leads[lead.id] = lead;
    } catch {}
  }
  for (const row of kvRows) {
    try {
      if (row.key === "conversations") store.conversations = JSON.parse(row.data ?? "") as Record<string, Conversation>;
      else if (row.key === "enrollments") store.enrollments = JSON.parse(row.data ?? "") as Enrollment[];
      else if (row.key === "kb") store.kb = { ...store.kb, ...(JSON.parse(row.data ?? "") as KbConfig) };
    } catch {}
  }
}

export function saveStore(): void {
  const database = openDb();
  database.exec("BEGIN");
  try {
    database.prepare("DELETE FROM leads").run();
    database.prepare("DELETE FROM kv").run();
    const leadStmt = database.prepare("INSERT OR REPLACE INTO leads (id, data) VALUES (?, ?)");
    for (const lead of Object.values(store.leads)) leadStmt.run(lead.id, JSON.stringify(lead));
    const kvStmt = database.prepare("INSERT OR REPLACE INTO kv (key, data) VALUES (?, ?)");
    kvStmt.run("conversations", JSON.stringify(store.conversations));
    kvStmt.run("kb", JSON.stringify(store.kb));
    kvStmt.run("enrollments", JSON.stringify(store.enrollments));
    database.exec("COMMIT");
  } catch (err) {
    database.exec("ROLLBACK");
    throw err;
  }
}

export function listEnrollments(): Enrollment[] {
  return store.enrollments;
}

export function saveEnrollment(enrollment: Enrollment): Enrollment {
  const idx = store.enrollments.findIndex((e) => e.id === enrollment.id);
  if (idx >= 0) store.enrollments[idx] = enrollment;
  else store.enrollments.push(enrollment);
  saveStore();
  return enrollment;
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

export function findContactEmail(leadId: string): string | undefined {
  const conv = Object.values(store.conversations).find((c) => c.leadId === leadId && c.contact?.email);
  return conv?.contact?.email;
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
  store = emptyStore();
  const database = openDb();
  database.exec("DELETE FROM leads");
  database.exec("DELETE FROM kv");
  if (fs.existsSync(LEGACY_FILE)) fs.rmSync(LEGACY_FILE);
}

loadStore();
