import type { Audit, Lead, SeoPack } from "./store.ts";

export interface SiteCopy {
  headline: string;
  subhead: string;
  about: string;
}

export interface Theme {
  accent: string;
  dark: string;
  heroImage: string;
}

export const THEMES: Record<string, Theme> = {
  restaurant: { accent: "#c0392b", dark: "#2c1810", heroImage: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1600" },
  dentist: { accent: "#0e7490", dark: "#0f2f3d", heroImage: "https://images.unsplash.com/photo-1606811841689-23dfddce3e95?w=1600" },
  plumber: { accent: "#1d4ed8", dark: "#0f1e3d", heroImage: "https://images.unsplash.com/photo-1581092918056-0c4c3acd3789?w=1600" },
  salon: { accent: "#a3417f", dark: "#2d1226", heroImage: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=1600" },
  "auto repair": { accent: "#b45309", dark: "#291a0a", heroImage: "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=1600" },
  hvac: { accent: "#047857", dark: "#0a2722", heroImage: "https://images.unsplash.com/photo-1631545806609-c2b8a3f71b39?w=1600" },
  landscaping: { accent: "#3f6212", dark: "#182309", heroImage: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1600" },
  "local business": { accent: "#ff7000", dark: "#231a12", heroImage: "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600" },
};

export function themeFor(category: string): Theme {
  return THEMES[Object.keys(THEMES).find((k) => category.includes(k)) ?? "local business"];
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface TemplateContext {
  lead: Lead;
  copy: SiteCopy;
  services: string[];
  seo?: SeoPack;
  audit?: Audit | null;
  theme: Theme;
}

export interface TemplateDef {
  id: string;
  name: string;
  suits: string[];
  render: (ctx: TemplateContext) => string;
}

function metaFor(ctx: TemplateContext): { title: string; description: string; schema: object } {
  const { lead, copy, seo } = ctx;
  const title = seo?.metaTitle || `${lead.name} | ${lead.category} in ${lead.city}`;
  const description = seo?.metaDescription || copy.subhead;
  const schema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: lead.name,
    description,
    telephone: lead.phone ?? "",
    address: lead.address ?? `${lead.city}`,
    ...(lead.rating !== undefined ? { aggregateRating: { "@type": "AggregateRating", ratingValue: lead.rating, reviewCount: lead.reviews ?? 1 } } : {}),
  };
  return { title, description, schema };
}

function trustHtml(ctx: TemplateContext): string {
  const { lead } = ctx;
  return lead.rating !== undefined
    ? `<span class="trust-stars">★ ${lead.rating}</span><span class="trust-muted">${lead.reviews ?? 0} Google reviews</span>`
    : `<span class="trust-muted">Locally owned and operated</span>`;
}

function footerHtml(ctx: TemplateContext): string {
  const { lead, audit } = ctx;
  return `© ${new Date().getFullYear()} ${escapeHtml(lead.name)} · ${escapeHtml(lead.city)}${audit ? ` · Site audit score improved from ${audit.score}/100` : ""}`;
}

function docHead(title: string, description: string, schema: object, css: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="icon" href="data:,">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<style>${css}</style>
</head>`;
}

const classicTemplate: TemplateDef = {
  id: "classic",
  name: "Classic hero",
  suits: ["restaurant", "salon", "landscaping"],
  render: (ctx) => {
    const { lead, copy, services, theme } = ctx;
    const { title, description, schema } = metaFor(ctx);
    return `${docHead(title, description, schema, `
  *{box-sizing:border-box;margin:0}
  body{font-family:system-ui,sans-serif;color:${theme.dark};line-height:1.55}
  header{min-height:60vh;background:linear-gradient(rgba(0,0,0,.55),rgba(0,0,0,.65)),url(${theme.heroImage}) center/cover;display:flex;flex-direction:column;justify-content:center;color:#fff;padding:32px;gap:12px}
  header h1{font-size:clamp(28px,5vw,52px);max-width:20ch}
  header p{font-size:clamp(16px,2vw,20px);max-width:48ch;opacity:.95}
  .cta-row{display:flex;gap:12px;flex-wrap:wrap;margin-top:8px}
  .btn{background:${theme.accent};color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600}
  .btn.ghost{background:transparent;border:2px solid #fff}
  .trust-stars{color:#fbbf24}
  .trust-muted{opacity:.8;font-size:14px;margin-left:8px}
  section{padding:48px 32px;max-width:900px;margin:0 auto}
  h2{font-size:28px;margin-bottom:20px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px}
  .card{border:1px solid #e5e7eb;border-radius:10px;padding:18px;font-weight:600;background:#fafafa}
  footer{background:${theme.dark};color:#fff;padding:32px;text-align:center}
`)}
<body>
<header>
  <h1>${copy.headline}</h1>
  <p>${copy.subhead}</p>
  <div>${trustHtml(ctx)}</div>
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
<footer>${footerHtml(ctx)}</footer>
</body>
</html>`;
  },
};

const spotlightTemplate: TemplateDef = {
  id: "spotlight",
  name: "Spotlight (image-forward)",
  suits: ["restaurant", "salon", "landscaping"],
  render: (ctx) => {
    const { lead, copy, services, theme } = ctx;
    const { title, description, schema } = metaFor(ctx);
    return `${docHead(title, description, schema, `
  *{box-sizing:border-box;margin:0}
  body{font-family:Georgia,'Times New Roman',serif;color:#1f1b16;line-height:1.6;background:#fffdf9}
  .nav{display:flex;justify-content:space-between;align-items:center;padding:18px 32px;background:#fffdf9;border-bottom:3px solid ${theme.accent}}
  .nav b{font-size:20px;color:${theme.dark}}
  .nav a{background:${theme.accent};color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-family:system-ui,sans-serif;font-weight:600;font-size:14px}
  .hero{display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center;padding:64px 32px;max-width:1080px;margin:0 auto}
  .hero h1{font-size:clamp(30px,4.5vw,56px);color:${theme.dark}}
  .hero p{margin-top:14px;font-size:18px;color:#57534e;max-width:46ch}
  .hero-img{border-radius:18px;min-height:340px;background:url(${theme.heroImage}) center/cover;box-shadow:0 24px 48px rgba(0,0,0,.18)}
  .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
  .chip{border:1.5px solid ${theme.accent};color:${theme.dark};background:#fff;border-radius:999px;padding:6px 14px;font-size:14px;font-family:system-ui,sans-serif}
  .band{background:${theme.dark};color:#fff;text-align:center;padding:36px 24px;font-family:system-ui,sans-serif}
  .band a{display:inline-block;margin-top:12px;background:${theme.accent};color:#fff;padding:12px 26px;border-radius:8px;text-decoration:none;font-weight:700}
  section{padding:48px 32px;max-width:900px;margin:0 auto}
  h2{font-size:30px;color:${theme.dark};margin-bottom:18px;font-style:italic}
  .svc{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .svc div{background:#fff;border-left:4px solid ${theme.accent};padding:14px 16px;font-family:system-ui,sans-serif;font-weight:600;border-radius:0 10px 10px 0;box-shadow:0 2px 8px rgba(0,0,0,.06)}
  .about{max-width:64ch}
  footer{background:#f5f0e8;padding:28px;text-align:center;color:#78716c;font-family:system-ui,sans-serif;font-size:14px}
  @media(max-width:760px){.hero{grid-template-columns:1fr}.hero-img{min-height:220px}}
`)}
<body>
<nav class="nav"><b>${escapeHtml(lead.name)}</b><a href="tel:${lead.phone ?? ""}">Call ${escapeHtml(lead.phone ?? "us")}</a></nav>
<div class="hero">
  <div>
    <h1>${copy.headline}</h1>
    <p>${copy.subhead}</p>
    <div class="chips">${services.map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join("")}</div>
  </div>
  <div class="hero-img" role="img" aria-label="${escapeHtml(lead.name)}"></div>
</div>
<section>
  <h2>Our services</h2>
  <div class="svc">${services.map((s) => `<div>${escapeHtml(s)}</div>`).join("")}</div>
</section>
<section class="about">
  <h2>About ${escapeHtml(lead.name)}</h2>
  <p>${copy.about}</p>
  <p style="margin-top:12px">${trustHtml(ctx)}</p>
</section>
<div class="band">
  Ready when you are — call, or stop by in ${escapeHtml(lead.city)}.
  <br><a href="tel:${lead.phone ?? ""}">Call now</a>
</div>
<footer>${footerHtml(ctx)}</footer>
</body>
</html>`;
  },
};

const trustbarTemplate: TemplateDef = {
  id: "trustbar",
  name: "Trust bar (reviews-forward)",
  suits: ["plumber", "hvac", "auto repair"],
  render: (ctx) => {
    const { lead, copy, services, theme } = ctx;
    const { title, description, schema } = metaFor(ctx);
    const stats =
      lead.rating !== undefined
        ? `<div class="stat"><b>${lead.rating}★</b><span>Google rating</span></div>
      <div class="stat"><b>${lead.reviews ?? 0}</b><span>Verified reviews</span></div>
      <div class="stat"><b>Free</b><span>Estimates & quotes</span></div>
      <div class="stat"><b>Local</b><span>${escapeHtml(lead.city)} owned</span></div>`
        : `<div class="stat"><b>Fast</b><span>Same-week service</span></div>
      <div class="stat"><b>Free</b><span>Estimates & quotes</span></div>
      <div class="stat"><b>Local</b><span>${escapeHtml(lead.city)} owned</span></div>
      <div class="stat"><b>0%</b><span>Surprise fees</span></div>`;
    const steps = services.map((s, i) => `<li><b>${i + 1}.</b> ${escapeHtml(s)}</li>`).join("");
    return `${docHead(title, description, schema, `
  *{box-sizing:border-box;margin:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;color:#111827;line-height:1.6}
  .topbar{display:flex;justify-content:space-between;align-items:center;padding:14px 32px;background:${theme.dark};color:#fff}
  .topbar b{font-size:18px}
  .topbar a{background:${theme.accent};color:#fff;text-decoration:none;font-weight:700;padding:10px 20px;border-radius:6px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1px;background:${theme.accent}}
  .stat{background:#fff;text-align:center;padding:22px 10px}
  .stat b{display:block;font-size:26px;color:${theme.accent}}
  .stat span{font-size:13px;color:#6b7280}
  .hero{background:linear-gradient(135deg,${theme.dark},#111827);color:#fff;padding:56px 32px}
  .hero h1{font-size:clamp(28px,4.5vw,46px);max-width:24ch}
  .hero p{margin-top:12px;max-width:52ch;opacity:.9;font-size:17px}
  section{padding:44px 32px;max-width:880px;margin:0 auto}
  h2{font-size:26px;margin-bottom:16px;color:${theme.dark}}
  ol{padding-left:0;list-style:none;counter-reset:none}
  ol li{padding:14px 0;border-bottom:1px solid #e5e7eb;font-size:17px}
  ol li b{color:${theme.accent};margin-right:8px}
  .midcta{background:${theme.accent};color:#fff;text-align:center;padding:40px 24px}
  .midcta a{display:inline-block;margin-top:14px;background:#fff;color:${theme.dark};padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:800;font-size:17px}
  .about{color:#374151;max-width:64ch}
  footer{background:#111827;color:#9ca3af;padding:26px;text-align:center;font-size:14px}
`)}
<body>
<div class="topbar"><b>${escapeHtml(lead.name)}</b><a href="tel:${lead.phone ?? ""}">Call now</a></div>
<div class="stats">${stats}</div>
<div class="hero">
  <h1>${copy.headline}</h1>
  <p>${copy.subhead}</p>
</div>
<section>
  <h2>What we do</h2>
  <ol>${steps}</ol>
</section>
<div class="midcta">
  One call gets it handled — serving ${escapeHtml(lead.city)} and nearby.
  <br><a href="tel:${lead.phone ?? ""}">Call ${escapeHtml(lead.phone ?? "now")}</a>
</div>
<section class="about">
  <h2>Why ${escapeHtml(lead.name)}?</h2>
  <p>${copy.about}</p>
</section>
<footer>${footerHtml(ctx)}</footer>
</body>
</html>`;
  },
};

const minimalTemplate: TemplateDef = {
  id: "minimal",
  name: "Minimal (clean pro)",
  suits: ["dentist", "local business"],
  render: (ctx) => {
    const { lead, copy, services, theme } = ctx;
    const { title, description, schema } = metaFor(ctx);
    return `${docHead(title, description, schema, `
  *{box-sizing:border-box;margin:0}
  body{font-family:'Helvetica Neue',system-ui,sans-serif;color:#1f2937;line-height:1.65;background:#fff}
  .wrap{max-width:860px;margin:0 auto;padding:0 28px}
  .brand{padding:22px 0;border-bottom:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center}
  .brand b{color:${theme.accent};font-size:18px}
  .brand a{text-decoration:none;color:${theme.accent};font-weight:600}
  .hero{text-align:center;padding:72px 0 56px}
  .hero h1{font-size:clamp(30px,4.5vw,48px);font-weight:700;color:#111827;max-width:22ch;margin:0 auto}
  .hero p{margin-top:16px;color:#4b5563;font-size:18px;max-width:52ch;margin-inline:auto}
  .hero .btn{display:inline-block;margin-top:26px;background:${theme.accent};color:#fff;padding:13px 30px;border-radius:10px;text-decoration:none;font-weight:600}
  .rule{width:64px;height:3px;background:${theme.accent};margin:26px auto 0;border-radius:2px}
  section{padding:40px 0}
  h2{text-align:center;font-size:24px;color:#111827;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px}
  .grid div{border-top:3px solid ${theme.accent};background:#f9fafb;padding:18px;border-radius:0 0 10px 10px;font-weight:600;font-size:15px}
  .about{max-width:60ch;margin:0 auto;color:#374151;text-align:center}
  .contact{background:#f9fafb;border-radius:14px;padding:32px;text-align:center;margin:24px 0}
  .contact b{color:${theme.accent}}
  footer{border-top:1px solid #e5e7eb;padding:24px;text-align:center;color:#6b7280;font-size:13px}
`)}
<body>
<div class="wrap">
  <div class="brand"><b>${escapeHtml(lead.name)}</b><a href="tel:${lead.phone ?? ""}">${escapeHtml(lead.phone ?? "Contact us")}</a></div>
  <div class="hero">
    <h1>${copy.headline}</h1>
    <p>${copy.subhead}</p>
    <a class="btn" href="tel:${lead.phone ?? ""}">Call now</a>
    <div class="rule"></div>
    <div style="margin-top:18px">${trustHtml(ctx)}</div>
  </div>
  <section>
    <h2>Services</h2>
    <div class="grid">${services.map((s) => `<div>${escapeHtml(s)}</div>`).join("")}</div>
  </section>
  <section class="about">
    <h2>About</h2>
    <p>${copy.about}</p>
  </section>
  <section class="contact">
    <h2 style="margin-bottom:8px">Get in touch</h2>
    <p>Call <b>${escapeHtml(lead.phone ?? "us today")}</b> or visit us at ${escapeHtml(lead.address ?? lead.city)}.</p>
  </section>
  <footer>${footerHtml(ctx)}</footer>
</div>
</body>
</html>`;
  },
};

export const TEMPLATES: TemplateDef[] = [classicTemplate, spotlightTemplate, trustbarTemplate, minimalTemplate];

export function listTemplates(): { id: string; name: string; suits: string[] }[] {
  return TEMPLATES.map((t) => ({ id: t.id, name: t.name, suits: t.suits }));
}

export function pickTemplate(category: string, hint?: string): TemplateDef {
  if (hint) {
    const exact = TEMPLATES.find((t) => t.id === hint.toLowerCase());
    if (exact) return exact;
  }
  const cat = category.toLowerCase();
  for (const t of TEMPLATES) {
    if (t.suits.some((s) => cat.includes(s))) return t;
  }
  return minimalTemplate;
}
