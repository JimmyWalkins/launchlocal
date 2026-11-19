import { randomUUID } from "node:crypto";
import { config, hasPlaces } from "./config.ts";
import { leadScore } from "./score.ts";
import type { Lead } from "./store.ts";

export interface SearchArgs {
  category: string;
  city: string;
  limit?: number;
}

const DEMO_LEADS: Omit<Lead, "id" | "score" | "createdAt" | "source">[] = [
  { name: "Rosie's Taqueria", category: "restaurant", city: "Bakersfield", address: "2100 Chester Ave, Bakersfield", phone: "+16615550134", rating: 4.6, reviews: 212 },
  { name: "Central Valley Dental", category: "dentist", city: "Bakersfield", address: "3801 Riverlakes Dr, Bakersfield", phone: "+16615550188", website: "http://centralvalleydental.net", rating: 3.8, reviews: 12 },
  { name: "Golden Valley Plumbing", category: "plumber", city: "Bakersfield", address: "918 Truxtun Ave, Bakersfield", phone: "+16615550101", rating: 4.1, reviews: 27 },
  { name: "Blanche's Beauty Bar", category: "salon", city: "Bakersfield", address: "4900 Stockdale Hwy, Bakersfield", phone: "+16615550177", website: "https://blanchesbeautybar.com", rating: 4.9, reviews: 340 },
  { name: "Bakersfield Auto Glass", category: "auto repair", city: "Bakersfield", address: "3300 Buck Owens Blvd, Bakersfield", phone: "+16615550123", rating: 3.2, reviews: 8 },
  { name: "Oildale HVAC Pros", category: "hvac", city: "Bakersfield", address: "2500 N Chester Ave, Bakersfield", phone: "+16615550199", website: "http://oildalehvacpros.net", rating: 4.4, reviews: 19 },
  { name: "Sage & Stone Landscaping", category: "landscaping", city: "Bakersfield", address: "700 Wwind Way, Bakersfield", phone: "+16615550140", rating: 4.0, reviews: 5 },
  { name: "Metro Collision Center", category: "auto repair", city: "Bakersfield", address: "4160 Weedpatch Hwy, Bakersfield", phone: "+16615550166", website: "https://metrocollisionbakersfield.com", rating: 4.7, reviews: 96 },
];

interface PlaceResult {
  displayName?: { text?: string };
  formattedAddress?: string;
  websiteUri?: string;
  rating?: number;
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  primaryTypeDisplayName?: { text?: string };
}

function normalizeCategory(raw: string): string {
  return raw.trim().toLowerCase() || "local business";
}

function toLead(name: string, category: string, city: string, fields: Partial<Lead>, source: Lead["source"]): Lead {
  return {
    id: randomUUID(),
    name,
    category,
    city,
    source,
    createdAt: new Date().toISOString(),
    ...fields,
    score: leadScore({ website: fields.website, rating: fields.rating, reviews: fields.reviews }),
  };
}

async function searchPlaces(args: SearchArgs): Promise<Lead[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": config.placesKey!,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.websiteUri,places.rating,places.userRatingCount,places.nationalPhoneNumber,places.primaryTypeDisplayName",
    },
    body: JSON.stringify({ textQuery: `${args.category} in ${args.city}`, pageSize: Math.min(args.limit ?? 10, 20) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`Google Places API error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { places?: PlaceResult[] };
  return (data.places ?? [])
    .slice(0, args.limit ?? 10)
    .map((p) =>
      toLead(
        p.displayName?.text ?? "Unknown business",
        p.primaryTypeDisplayName?.text?.toLowerCase() ?? normalizeCategory(args.category),
        args.city,
        {
          address: p.formattedAddress,
          website: p.websiteUri,
          rating: p.rating,
          reviews: p.userRatingCount,
          phone: p.nationalPhoneNumber,
        },
        "google",
      ),
    );
}

function searchDemo(args: SearchArgs): Lead[] {
  const cat = normalizeCategory(args.category);
  const filtered = DEMO_LEADS.filter(
    (l) => cat === "any" || cat === "all" || l.category.includes(cat) || cat.includes(l.category) || "local business".includes(cat),
  );
  const chosen = (filtered.length ? filtered : DEMO_LEADS).slice(0, args.limit ?? 10);
  return chosen.map((l) => toLead(l.name, l.category, l.city, { address: l.address, website: l.website, rating: l.rating, reviews: l.reviews, phone: l.phone }, "demo"));
}

export async function searchLeads(args: SearchArgs): Promise<{ leads: Lead[]; source: "google" | "demo" }> {
  if (hasPlaces()) {
    const leads = await searchPlaces(args);
    return { leads, source: "google" };
  }
  return { leads: searchDemo(args), source: "demo" };
}
