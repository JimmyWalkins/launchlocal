import { aiAvailable, aiJson } from "./ai.ts";

export interface AdsAuditInput {
  monthlySpend?: number;
  tracksConversions?: boolean;
  hasNegativeKeywords?: boolean;
  hasLandingPage?: boolean;
  targetsOwnBusinessName?: boolean;
  broadMatchOnly?: boolean;
  multipleAdVariants?: boolean;
  callTracking?: boolean;
}

export interface AdsFinding {
  severity: "waste" | "risk" | "improvement";
  title: string;
  detail: string;
  monthlyImpact?: number;
}

export interface AdsAuditResult {
  score: number;
  verdict: string;
  findings: AdsFinding[];
  estimatedMonthlyWaste: number;
  pitch: string;
  source: "ai" | "heuristic";
}

function heuristicAudit(input: AdsAuditInput): AdsAuditResult {
  const spend = input.monthlySpend ?? 0;
  const findings: AdsFinding[] = [];
  const share = (pct: number) => Math.round(spend * pct);

  if (spend <= 0) {
    findings.push({ severity: "risk", title: "No ad spend detected", detail: "If you intend to run Google/Facebook ads, we should set the budget and targeting together so every dollar is tracked." });
  }
  if (spend > 0 && !input.tracksConversions) {
    findings.push({ severity: "waste", title: "No conversion tracking", detail: "Without tracking calls/form fills, there is no way to know which clicks turn into customers. Install conversion tracking before anything else.", monthlyImpact: share(0.15) });
  }
  if (spend > 0 && !input.hasNegativeKeywords) {
    findings.push({ severity: "waste", title: "No negative keyword list", detail: "Broad campaigns pay for searches like 'DIY', 'free', and 'jobs'. A 50-100 term negative list is the fastest save in local PPC.", monthlyImpact: share(0.25) });
  }
  if (spend > 0 && input.broadMatchOnly) {
    findings.push({ severity: "waste", title: "Broad match everywhere", detail: "All broad match keywords burns budget on unrelated searches. Move top queries to phrase/exact and add the rest to negatives.", monthlyImpact: share(0.2) });
  }
  if (spend > 0 && input.targetsOwnBusinessName) {
    findings.push({ severity: "improvement", title: "Bidding on your own name is optional", detail: "Branded searches usually end in a call to you anyway. If you target your own name, cap that bid low.", monthlyImpact: share(0.1) });
  }
  if (spend > 0 && !input.hasLandingPage) {
    findings.push({ severity: "risk", title: "Ads pointing at the homepage or no page", detail: "Ads convert best on a dedicated page with one offer and one call button. We build these.", monthlyImpact: share(0.2) });
  }
  if (spend > 0 && !input.multipleAdVariants) {
    findings.push({ severity: "improvement", title: "Single ad per group", detail: "Run 2-3 ad variants per group; Google's optimization works only with options and CTR typically rises within weeks." });
  }
  if (spend > 0 && !input.callTracking) {
    findings.push({ severity: "improvement", title: "No call tracking", detail: "Most local service leads arrive by phone. Call tracking attributes them so you can see the real cost per lead." });
  }

  const waste = findings.reduce((sum, f) => sum + (f.monthlyImpact ?? 0), 0);
  const riskCount = findings.filter((f) => f.severity !== "improvement").length;
  const score = Math.max(0, 100 - riskCount * 18);
  return {
    score,
    verdict: score >= 70 ? "Healthy overall — a few optimizations left on the table." : score >= 40 ? "Meaningful waste found. Worth fixing this month." : "Serious waste — much of this budget is likely not producing customers.",
    findings,
    estimatedMonthlyWaste: waste,
    pitch:
      spend > 0 && waste > 0
        ? `We estimate roughly $${waste}/month of this budget drives no customers. Our SEO Care plan is $299/month — usually cheaper than the waste itself, and we'll fix the ad settings as part of onboarding.`
        : "Want a free second opinion? Launch Local 661 will audit any Google/Facebook ads account at no charge.",
    source: "heuristic",
  };
}

export async function auditAds(input: AdsAuditInput): Promise<AdsAuditResult> {
  if (!aiAvailable()) return heuristicAudit(input);
  const ai = await aiJson<AdsAuditResult>(
    "You are a PPC auditor for small local businesses. Find concrete waste and risks; be blunt and specific.",
    [
      `Monthly ad spend: $${input.monthlySpend ?? "unknown"}.`,
      `Conversion tracking: ${input.tracksConversions ? "yes" : "no"}. Negative keywords: ${input.hasNegativeKeywords ? "yes" : "no"}.`,
      `Keyword match: ${input.broadMatchOnly ? "broad only" : "mixed"}. Landing page: ${input.hasLandingPage ? "yes" : "no"}.`,
      `Targets own business name: ${input.targetsOwnBusinessName ? "yes" : "no"}. Ad variants: ${input.multipleAdVariants ? "yes" : "no"}. Call tracking: ${input.callTracking ? "yes" : "no"}.`,
      "Return JSON: score (0-100 health), verdict (1 sentence), findings (array of {severity: waste|risk|improvement, title, detail, monthlyImpact? in dollars, omit when unknown}), estimatedMonthlyWaste (dollars), pitch (1 sentence selling the $299/mo SEO Care plan).",
    ].join("\n"),
  );
  if (ai && Array.isArray(ai.findings)) return { ...ai, source: "ai" };
  return heuristicAudit(input);
}
