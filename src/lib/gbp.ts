import { aiAvailable, aiJson } from "./ai.ts";
import { getLead, saveStore, updateLead, type GbpPack, type Lead } from "./store.ts";

function heuristicPack(lead: Lead): GbpPack {
  const cat = lead.category.toLowerCase();
  const serviceByCat: Record<string, string[]> = {
    restaurant: ["weekend special", "family meal deal", "catering", "new menu item"],
    dentist: ["teeth whitening", "emergency appointments", "new-patient exam", "insurance acceptance"],
    plumber: ["emergency repair", "water heater install", "drain cleaning", "free estimates"],
    salon: ["new stylist", "seasonal color", "wedding packages", "last-minute openings"],
    "auto repair": ["free inspection", "collision specials", "same-day service", "insurance claims"],
    hvac: ["AC tune-up", "heating check", "maintenance plan", "second-opinion quotes"],
    landscaping: ["spring cleanup", "irrigation", "monthly maintenance", "free design consult"],
    "local business": ["special offer", "this week's availability", "free estimate", "community involvement"],
  };
  const keys = Object.keys(serviceByCat);
  const svc = serviceByCat[keys.find((k) => cat.includes(k)) ?? "local business"];
  return {
    checklist: [
      `Claim and verify the Google Business Profile for ${lead.name}`,
      `Set primary category to "${lead.category}" and add up to 9 secondary categories`,
      `Fill hours (incl. holiday hours), service area, and ${lead.phone ?? "phone"}`,
      `Add the website link${lead.siteUrl ? ` (${lead.siteUrl})` : ""} and an appointment/booking URL`,
      `Upload at least 10 real photos of the team, work, and exterior`,
      `Fill the "From the business" description with ${lead.city} + services keywords`,
      `Add all services/products with descriptions and prices where possible`,
      `Enable and answer messaging; reply to every review within 24h`,
      `Post weekly (Google rewards an active profile) — ideas below`,
      `Add Q&A: seed 3-5 common customer questions and answer them yourself`,
    ],
    postIdeas: [
      `This week's highlight: ${svc[0]} — book/stop by this week`,
      `Meet the team: short intro of the owner of ${lead.name}`,
      `Customer win: share a recent 5-star review with a thank-you`,
      `Before/after: photo post of a recent ${svc[1] ?? "job"} in ${lead.city}`,
    ],
    photoIdeas: ["Storefront with sign visible", "Team at work (2-3 shots)", "Happy customer (with permission)", "Recent completed job"],
    categories: [lead.category],
    source: "heuristic",
  };
}

export async function buildGbpPack(leadId: string): Promise<{ lead: Lead; pack: GbpPack }> {
  const lead = getLead(leadId);
  if (!lead) throw new Error("unknown lead");
  let pack: GbpPack | null = null;
  if (aiAvailable()) {
    pack = await aiJson<GbpPack>(
      "You are a local SEO specialist. You produce actionable Google Business Profile plans for small businesses.",
      [
        `Business: ${lead.name} (${lead.category}) in ${lead.city}, phone ${lead.phone ?? "unknown"}.`,
        "Return JSON: checklist (10 short action strings), postIdeas (4 weekly post ideas), photoIdeas (4 strings), categories (3 category suggestions).",
      ].join("\n"),
    );
  }
  const finalPack = pack && Array.isArray(pack.checklist) && pack.checklist.length >= 5 ? { ...pack, source: "ai" as const } : heuristicPack(lead);
  updateLead(lead.id, {
    gbp: finalPack,
    timeline: [...(lead.timeline ?? []), { ts: new Date().toISOString(), event: "gbp_pack_built", detail: `Google Business Profile pack (${finalPack.source})` }],
  });
  saveStore();
  return { lead: getLead(lead.id)!, pack: finalPack };
}
