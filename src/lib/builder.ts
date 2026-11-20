import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aiAvailable, aiJson } from "./ai.ts";
import { escapeHtml, pickTemplate, themeFor, type SiteCopy } from "./templates.ts";
import type { Audit, Lead, SeoPack } from "./store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITES_DIR = path.join(__dirname, "..", "..", "public", "sites");

function servicesFor(category: string): string[] {
  const keys = ["restaurant", "dentist", "plumber", "salon", "auto repair", "hvac", "landscaping"];
  const key = keys.find((k) => category.includes(k));
  const map: Record<string, string[]> = {
    restaurant: ["Dine-in", "Takeout & delivery", "Catering", "Family combos"],
    dentist: ["Cleanings & exams", "Emergency care", "Cosmetic dentistry", "Insurance-friendly billing"],
    plumber: ["24/7 emergency repairs", "Drain cleaning", "Water heaters", "Free estimates"],
    salon: ["Cuts & styling", "Color & highlights", "Manicure & pedicure", "Wedding packages"],
    "auto repair": ["Diagnostics", "Collision repair", "Free quotes", "Insurance claims welcome"],
    hvac: ["AC repair & install", "Heating service", "Maintenance plans", "Free second opinions"],
    landscaping: ["Design & install", "Maintenance programs", "Irrigation", "Seasonal cleanup"],
    "local business": ["Consultations", "Same-week service", "Free estimates", "Locally owned"],
  };
  return map[key ?? "local business"];
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "site";
}

async function generateCopy(lead: Lead, services: string[]): Promise<SiteCopy | null> {
  if (!aiAvailable()) return null;
  return aiJson<SiteCopy>(
    "You write hero copy for small local business landing pages. Warm, trustworthy, concrete. No hype.",
    [
      `Write copy for a one-page site for: ${lead.name} (${lead.category}) in ${lead.city}.`,
      lead.rating !== undefined ? `They have a ${lead.rating}-star Google rating from ${lead.reviews ?? 0} reviews.` : "",
      `Main services: ${services.join(", ")}.`,
      "Return JSON: headline (<=55 chars, mention city), subhead (<=120 chars), about (2 sentences).",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function fallbackCopy(lead: Lead, services: string[]): SiteCopy {
  return {
    headline: `${escapeHtml(lead.name)} — ${lead.category} in ${escapeHtml(lead.city)}`,
    subhead: `Trusted local ${lead.category.toLowerCase()} offering ${services.slice(0, 2).join(" and ").toLowerCase()}. Free estimates, fast scheduling.`,
    about: `${escapeHtml(lead.name)} has served ${escapeHtml(lead.city)} with reliable, friendly service. Every job gets a clear quote, quality work, and a satisfaction guarantee.`,
  };
}

export async function buildSite(
  lead: Lead,
  seo: SeoPack | undefined,
  audit?: Audit | null,
  templateHint?: string,
): Promise<{ fileName: string; html: string; copySource: "ai" | "heuristic"; template: string }> {
  const services = servicesFor(lead.category);
  const copy = (await generateCopy(lead, services)) ?? fallbackCopy(lead, services);
  const template = pickTemplate(lead.category, templateHint);
  const html = template.render({
    lead,
    copy,
    services,
    seo,
    audit,
    theme: themeFor(lead.category),
  });
  const fileName = `${slugify(lead.name)}.html`;
  fs.mkdirSync(SITES_DIR, { recursive: true });
  fs.writeFileSync(path.join(SITES_DIR, fileName), html);
  return { fileName, html, copySource: aiAvailable() ? "ai" : "heuristic", template: template.id };
}
