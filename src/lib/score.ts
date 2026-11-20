export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

interface LeadSignals {
  website?: string;
  rating?: number;
  reviews?: number;
}

export function leadScore(lead: LeadSignals): number {
  let score = lead.website ? 45 : 75;
  if (lead.rating !== undefined && lead.rating < 3.5) score += 12;
  else if (lead.rating !== undefined && lead.rating < 4.2) score += 6;
  if (lead.reviews !== undefined && lead.reviews < 10) score += 10;
  else if (lead.reviews !== undefined && lead.reviews < 40) score += 4;
  if (lead.reviews !== undefined && lead.reviews > 150) score -= 8;
  return clamp(Math.round(score), 0, 100);
}

export function auditScore(audit: { reachable: boolean; score: number }): number {
  if (!audit.reachable) return 95;
  return clamp(100 - audit.score + 10, 0, 100);
}

export function combinedScore(lead: LeadSignals, audit?: { reachable: boolean; score: number } | null): number {
  if (!audit) return leadScore(lead);
  if (!lead.website || !audit.reachable) return clamp(leadScore(lead), 0, 100);
  return clamp(Math.round(auditScore(audit) * 0.85 + leadScore(lead) * 0.15), 0, 100);
}

export function scoreLabel(score: number): string {
  if (score >= 80) return "Very high need";
  if (score >= 60) return "High need";
  if (score >= 40) return "Moderate need";
  return "Low need";
}
