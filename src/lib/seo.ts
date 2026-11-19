import { aiAvailable, aiJson } from "./ai.ts";
import type { Audit, Lead, SeoPack } from "./store.ts";

const SERVICES: Record<string, string[]> = {
  restaurant: ["Dine-in", "Takeout & delivery", "Catering", "Family combos"],
  dentist: ["Cleanings & exams", "Emergency care", "Cosmetic dentistry", "Insurance-friendly billing"],
  plumber: ["24/7 emergency repairs", "Drain cleaning", "Water heaters", "Free estimates"],
  salon: ["Cuts & styling", "Color & highlights", "Manicure & pedicure", "Wedding packages"],
  "auto repair": ["Diagnostics", "Collision repair", "Free quotes", "Insurance claims welcome"],
  hvac: ["AC repair & install", "Heating service", "Maintenance plans", "Free second opinions"],
  landscaping: ["Design & install", "Maintenance programs", "Irrigation", "Seasonal cleanup"],
  "local business": ["Consultations", "Same-week service", "Free estimates", "Locally owned"],
};

function copySource(source: SeoPack["source"], fallback: Omit<SeoPack, "source">): SeoPack {
  return { ...fallback, source };
}

export async function buildSeoPack(lead: Lead, audit?: Audit | null): Promise<SeoPack> {
  const services = SERVICES[lead.category] ?? SERVICES["local business"];
  const weakPoints = audit ? audit.recommendations.slice(0, 4) : lead.website ? ["SEO gaps unknown — audit the website first"] : ["No website at all — the #1 fix is launching one"];

  if (aiAvailable()) {
    const prompt = [
      `Business: ${lead.name}`,
      `Industry: ${lead.category}`,
      `City: ${lead.city}`,
      `Website: ${lead.website ?? "none"}`,
      lead.rating !== undefined ? `Google rating: ${lead.rating} (${lead.reviews ?? 0} reviews)` : "",
      audit ? `Website audit score: ${audit.score}/100. Issues found: ${audit.checks.filter((c) => !c.pass).map((c) => c.label).join(", ") || "none"}` : "",
      "",
      "Create a local-SEO pack for this business.",
      'Return JSON with keys: metaTitle (<=60 chars), metaDescription (140-160 chars), keywords (8 strings, local intent), postIdeas (4 weekly Google Business Profile post ideas), improvements (4 prioritized action items).',
    ]
      .filter(Boolean)
      .join("\n");
    const parsed = await aiJson<Omit<SeoPack, "source">>(
      "You are a local SEO specialist for small businesses. Be concrete and mention the city naturally.",
      prompt,
    );
    if (parsed?.metaTitle && parsed.metaDescription && Array.isArray(parsed.keywords)) {
      return copySource("ai", {
        metaTitle: parsed.metaTitle.slice(0, 70),
        metaDescription: parsed.metaDescription,
        keywords: parsed.keywords.slice(0, 12),
        postIdeas: Array.isArray(parsed.postIdeas) ? parsed.postIdeas.slice(0, 6) : [],
        improvements: Array.isArray(parsed.improvements) ? parsed.improvements.slice(0, 6) : weakPoints,
      });
    }
  }

  return copySource("heuristic", {
    metaTitle: `${lead.name} | ${titleCase(lead.category)} in ${lead.city}`.slice(0, 60),
    metaDescription: `${lead.name} is a trusted ${lead.category.toLowerCase()} serving ${lead.city}. ${services.slice(0, 2).join(", ")} and more. Call ${lead.phone ?? "today"} for a free quote.`.slice(0, 160),
    keywords: [
      `${lead.category} ${lead.city}`,
      `best ${lead.category} near me`,
      `affordable ${lead.category} ${lead.city}`,
      `${lead.name} ${lead.city} reviews`,
      `${lead.category} quotes ${lead.city}`,
      `24/7 ${lead.category} ${lead.city}`,
      `top rated ${lead.category} ${lead.city}`,
      `${lead.city} ${lead.category} free estimate`,
    ],
    postIdeas: [
      `A before/after photo from a recent ${lead.category} job in ${lead.city}`,
      `A 5-star customer review quote with a thank-you message`,
      `A limited promo (e.g. first-time customer discount) with a phone CTA`,
      `A quick tip clients can apply today, positioning ${lead.name} as the local expert`,
    ],
    improvements: weakPoints,
  });
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
