import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aiAvailable, aiJson } from "./ai.ts";
import type { Audit, Lead, SeoPack } from "./store.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITES_DIR = path.join(__dirname, "..", "..", "public", "sites");

const THEMES: Record<string, { accent: string; dark: string; heroImage: string }> = {
  restaurant: { accent: "#c0392b", dark: "#2c1810", heroImage: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1600" },
  dentist: { accent: "#0e7490", dark: "#0f2f3d", heroImage: "https://images.unsplash.com/photo-1606811841689-23dfddce3e95?w=1600" },
  plumber: { accent: "#1d4ed8", dark: "#0f1e3d", heroImage: "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=1600" },
  salon: { accent: "#a3417f", dark: "#2d1226", heroImage: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=1600" },
  "auto repair": { accent: "#b45309", dark: "#291a0a", heroImage: "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=1600" },
  hvac: { accent: "#047857", dark: "#0a2722", heroImage: "https://images.unsplash.com/photo-1631545806609-c2b8a3f71b39?w=1600" },
  landscaping: { accent: "#3f6212", dark: "#182309", heroImage: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1600" },
  "local business": { accent: "#ff7000", dark: "#231a12", heroImage: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600" },
};

function servicesFor(category: string): string[] {
  const key = Object.keys(THEMES).find((k) => category.includes(k));
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

interface SiteCopy {
  headline: string;
  subhead: string;
  about: string;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "site";
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function generateCopy(lead: Lead, services: string[]): Promise<SiteCopy | null> {
  if (!aiAvailable()) return null;
  return aiJson<SiteCopy>(
    "You write hero copy for small local business landing pages. Warm, trustworthy, concrete. No hype.",
    [
      `Write copy for a one-page site for: ${lead.name} (${lead.category}) in ${lead.city}.`,
      lead.rating !== undefined ? `They have a ${lead.rating}-star Google rating from ${lead.reviews ?? 0} reviews.` : "",
      `Main services: ${services.join(", ")}.`,
      'Return JSON: headline (<=55 chars, mention city), subhead (<=120 chars), about (2 sentences).',
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

function renderSite(lead: Lead, copy: SiteCopy, services: string[], seo: SeoPack | undefined, audit?: Audit | null): string {
  const theme = THEMES[Object.keys(THEMES).find((k) => lead.category.includes(k)) ?? "local business"];
  const title = seo?.metaTitle || `${lead.name} | ${lead.category} in ${lead.city}`;
  const description = seo?.metaDescription || copy.subhead;
  const trust =
    lead.rating !== undefined
      ? `<span class="stars">★ ${lead.rating}</span><span class="muted">${lead.reviews ?? 0} Google reviews</span>`
      : `<span class="muted">Locally owned and operated</span>`;

  const schema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: lead.name,
    description,
    telephone: lead.phone ?? "",
    address: lead.address ?? `${lead.city}`,
    ...(lead.rating !== undefined ? { aggregateRating: { "@type": "AggregateRating", ratingValue: lead.rating, reviewCount: lead.reviews ?? 1 } } : {}),
  };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="icon" href="data:,">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<style>
  *{box-sizing:border-box;margin:0}
  body{font-family:system-ui,sans-serif;color:${theme.dark};line-height:1.55}
  header{min-height:60vh;background:linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.65)),url(${theme.heroImage}) center/cover;display:flex;flex-direction:column;justify-content:center;color:#fff;padding:32px;gap:12px}
  header h1{font-size:clamp(28px,5vw,52px);max-width:20ch}
  header p{font-size:clamp(16px,2vw,20px);max-width:48ch;opacity:.95}
  .cta-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px}
  .btn{background:${theme.accent};color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600}
  .btn.ghost{background:transparent;border:2px solid #fff}
  .stars{color:#fbbf24}
  .muted{opacity:.8;font-size:14px;margin-left:8px}
  section{padding:48px 32px;max-width:900px;margin:0 auto}
  h2{font-size:28px;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
  .card{border:1px solid #e5e7eb;border-radius:10px;padding:18px;font-weight:600;background:#fafafa}
  footer{background:${theme.dark};color:#fff;padding:32px;text-align:center}
  .schema{display:none}
</style>
</head>
<body>
<header>
  <h1>${copy.headline}</h1>
  <p>${copy.subhead}</p>
  <div>${trust}</div>
  <div class="cta-row">
    <a class="btn" href="tel:${lead.phone ?? ""}">Call now</a>
    <a class="btn ghost" href="#contact">Free quote</a>
  </div>
</header>
<section>
  <h2>Services</h2>
  <div class="grid">${services.map((s) => `<div class="card">${escapeHtml(s)}</div>`).join("")}</div>
</section>
<section>
  <h2>About</h2>
  <p>${copy.about}</p>
</section>
<section id="contact">
  <h2>Get a free quote</h2>
  <p>Call <strong>${lead.phone ?? "us today"}</strong> or visit us at ${escapeHtml(lead.address ?? lead.city)}.</p>
</section>
<footer>© ${new Date().getFullYear()} ${escapeHtml(lead.name)} · ${escapeHtml(lead.city)}${audit ? ` · Site audit score improved from ${audit.score}/100` : ""}</footer>
</body>
</html>`;
}

export async function buildSite(lead: Lead, seo: SeoPack | undefined, audit?: Audit | null): Promise<{ fileName: string; html: string; copySource: "ai" | "heuristic" }> {
  const services = servicesFor(lead.category);
  const copy = (await generateCopy(lead, services)) ?? fallbackCopy(lead, services);
  const html = renderSite(lead, copy, services, seo, audit);
  const fileName = `${slugify(lead.name)}.html`;
  fs.mkdirSync(SITES_DIR, { recursive: true });
  fs.writeFileSync(path.join(SITES_DIR, fileName), html);
  return { fileName, html, copySource: aiAvailable() ? "ai" : "heuristic" };
}
