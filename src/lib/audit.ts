import type { Audit, AuditCheck } from "./store.ts";

const UA = "Mozilla/5.0 (compatible; LaunchLocalBot/1.0; +https://launchlocal661.com)";
const TIMEOUT_MS = 12000;

function normalizeUrl(input: string): URL | null {
  let value = input.trim();
  if (!value || /\s/.test(value)) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    return url.hostname.includes(".") ? url : null;
  } catch {
    return null;
  }
}

async function fetchPage(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { redirect: "follow", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return null;
  }
}

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(6000) });
    return res.ok;
  } catch {
    return false;
  }
}

function getImageInfo(html: string): { count: number; altRatio: number } {
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  const withAlt = tags.filter((t) => /\balt=\s*["'][^"']+["']/i.test(t)).length;
  return { count: tags.length, altRatio: tags.length ? withAlt / tags.length : 1 };
}

function extract(html: string) {
  const getMeta = (name: string): string | undefined => {
    const m =
      html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i")) ??
      html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i"));
    return m?.[1]?.trim() || undefined;
  };
  const body = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return {
    title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "",
    description: getMeta("description"),
    viewport: getMeta("viewport"),
    h1: html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "",
    schema: /application\/ld\+json/i.test(html),
    favicon: /<link[^>]+rel=["'][^"']*icon[^"']*["']/i.test(html),
    words: body.split(/\s+/).filter(Boolean).length,
    ...getImageInfo(html),
  };
}

const ADVICE: Record<string, string> = {
  reachable: "Site is unreachable — fix DNS/hosting or replace the site.",
  https: "Install an SSL certificate and force https://.",
  speed: "Server responds slowly — enable caching/CDN or upgrade hosting.",
  title: "Add a descriptive page title (10-60 chars) including the main service and city.",
  "meta-description": "Write a compelling meta description of 70-160 characters — this is the ad text in Google results.",
  h1: "Add a single clear H1 headline describing the primary service.",
  mobile: "Add a mobile viewport meta tag — the site won't render properly on phones otherwise.",
  robots: "Publish a robots.txt so Google can crawl the site correctly.",
  sitemap: "Add a sitemap.xml and submit it in Google Search Console.",
  favicon: "Configure a favicon — it affects credibility in bookmarks and browser tabs.",
  schema: "Add LocalBusiness structured data (JSON-LD) for rich search results.",
  "alt-text": "Add alt-text to images for SEO and accessibility.",
  content: "Grow the page content to 200+ words describing services, areas served, and trust signals.",
};

export async function auditWebsite(rawUrl: string): Promise<Audit> {
  const parsed = normalizeUrl(rawUrl);
  if (!parsed) {
    return {
      url: rawUrl,
      reachable: false,
      responseMs: 0,
      checks: [{ id: "reachable", label: "Site reachable", pass: false, detail: `Could not parse URL: ${rawUrl}` }],
      score: 0,
      recommendations: ["Provide a resolvable website address to audit."],
    };
  }

  const started = Date.now();
  const res = await fetchPage(parsed.href);
  const responseMs = Date.now() - started;

  const reachable = res !== null && res.ok;
  const finalUrl = res?.url ?? parsed.href;

  if (!reachable) {
    return {
      url: finalUrl,
      reachable: false,
      responseMs,
      checks: [
        {
          id: "reachable",
          label: "Site reachable",
          pass: false,
          detail: res ? `HTTP ${res.status}` : "Request timed out or DNS failed",
        },
      ],
      score: 0,
      recommendations: [ADVICE.reachable],
    };
  }

  const html = await res!.text();
  const info = extract(html);
  const checks: AuditCheck[] = [];

  checks.push({ id: "reachable", label: "Site reachable", pass: true, detail: `HTTP ${res!.status}` });
  checks.push({ id: "https", label: "HTTPS secure", pass: finalUrl.startsWith("https://"), detail: finalUrl.startsWith("https://") ? "https:// enforced" : "Site not served over https://" });
  checks.push({ id: "speed", label: "Loads fast (<3s)", pass: responseMs < 3000, detail: `${(responseMs / 1000).toFixed(1)}s` });

  const titleLen = info.title.length;
  checks.push({
    id: "title",
    label: "Page title present & descriptive",
    pass: titleLen >= 10 && titleLen <= 60,
    detail: titleLen ? `"${info.title.slice(0, 80)}" (${titleLen} chars)` : "Missing",
  });

  const descLen = info.description?.length ?? 0;
  checks.push({
    id: "meta-description",
    label: "Meta description (70-160 chars)",
    pass: descLen >= 70 && descLen <= 160,
    detail: descLen ? `"${info.description}" (${descLen} chars)` : "Missing",
  });

  checks.push({ id: "h1", label: "H1 heading present", pass: Boolean(info.h1), detail: info.h1 ? `e.g. "${info.h1.slice(0, 60)}"` : "Missing" });
  checks.push({ id: "mobile", label: "Mobile viewport configured", pass: Boolean(info.viewport), detail: info.viewport || "Missing" });
  checks.push({ id: "robots", label: "robots.txt accessible", pass: await exists(`${parsed.origin}/robots.txt`), detail: parsed.origin });
  checks.push({ id: "sitemap", label: "sitemap.xml accessible", pass: await exists(`${parsed.origin}/sitemap.xml`), detail: parsed.origin });
  checks.push({ id: "favicon", label: "Favicon configured", pass: info.favicon, detail: info.favicon ? "Icon link found" : "No icon link found" });
  checks.push({ id: "schema", label: "Structured data (JSON-LD)", pass: info.schema, detail: info.schema ? "Found" : "Missing" });
  checks.push({
    id: "alt-text",
    label: "Image alt-text coverage > 50%",
    pass: info.altRatio >= 0.5,
    detail: info.count ? `${Math.round(info.altRatio * 100)}% of ${info.count} images` : "No images",
  });
  checks.push({ id: "content", label: "Content depth (200+ words)", pass: info.words >= 200, detail: `${info.words} words of visible text` });

  const score = Math.round((checks.filter((c) => c.pass).length / checks.length) * 100);
  const recommendations = checks.filter((c) => !c.pass).map((c) => ADVICE[c.id] ?? `Fix ${c.label.toLowerCase()}`);

  return { url: finalUrl, reachable: true, responseMs, checks, score, recommendations };
}
