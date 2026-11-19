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
  source: "google" | "demo" | "manual";
  audit?: Audit;
  seo?: SeoPack;
  siteUrl?: string;
  outreach?: { channel: "email" | "sms"; to: string; sentAt: string; provider: string; ok: boolean; body: string }[];
  createdAt: string;
}

export interface Store {
  leads: Record<string, Lead>;
}

let store: Store = { leads: {} };

export function loadStore(): void {
  if (fs.existsSync(DATA_FILE)) {
    try {
      store = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as Store;
      if (!store.leads) store.leads = {};
    } catch {
      store = { leads: {} };
    }
  } else {
    store = { leads: {} };
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
  store.leads[id] = { ...lead, ...patch };
  return store.leads[id];
}

export function resetStore(): void {
  store = { leads: {} };
  if (fs.existsSync(DATA_FILE)) fs.rmSync(DATA_FILE);
}
