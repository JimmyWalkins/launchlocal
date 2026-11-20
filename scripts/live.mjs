import assert from "node:assert/strict";
import fs from "node:fs";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

const { app } = await import("../src/server.ts");
const storeLib = await import("../src/lib/store.ts");

function mockRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.finished = false;
  res.headers = {};
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.writeHead = (code, headers) => {
    res.statusCode = code;
    if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    return res;
  };
  res.body = "";
  res.write = (chunk) => { res.body += String(chunk); };
  res.end = (chunk) => {
    if (chunk) res.write(chunk);
    res.emit("finish");
    return res;
  };
  return res;
}

function dispatch(method, url, body, extraHeaders = {}) {
  const payload = body ? Buffer.from(JSON.stringify(body)) : Buffer.from("");
  const req = Readable.from([payload]);
  req.method = method;
  req.url = url;
  req.headers = body
    ? { "content-type": "application/json", "content-length": payload.length.toString(), ...extraHeaders }
    : { ...extraHeaders };
  req.socket = { remoteAddress: "127.0.0.1" };
  return new Promise((resolve) => {
    const res = mockRes();
    res.on("finish", () => resolve(res));
    app.handle(req, res);
  });
}

const json = (res) => {
  try {
    return JSON.parse(res.body);
  } catch {
    return {};
  }
};

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) {
    console.log(`  PASS ${name}${extra ? ` — ${extra}` : ""}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

console.log("LIVE TEST — real Mistral API (mistral-small-latest + mistral-embed)");
console.log("======================================================================");

const statusRes = await dispatch("GET", "/api/status");
const status = json(statusRes);
check("Mistral key detected", status.integrations.mistral === true, `mistral=${status.integrations.mistral}`);

const chatRes = await dispatch("POST", "/api/chat", { messages: [{ role: "user", content: "Reply with exactly: LIVE_OK" }] });
const chat = json(chatRes);
check("/api/chat real reply", chatRes.statusCode === 200 && chat.reply && chat.reply.length > 0, JSON.stringify(chat.reply ?? chat.error).slice(0, 80));

const search = await dispatch("POST", "/api/leads/search", { category: "dentist", city: "Bakersfield" });
check("demo lead seeded", search.statusCode === 200);
const lead = json(await dispatch("GET", "/api/leads")).leads[0];
console.log(`  lead: ${lead.name} (${lead.category}, ${lead.city}) score=${lead.score}`);

const seeded = await dispatch("POST", "/api/kb", {
  brand: "Launch Local 661",
  offer: "Launch Pad one-page site $497 flat, live in 7 days. Full 5-page site $1,497. SEO Care $299/month. Free audit anytime.",
  faqs: [
    { q: "How much does a website cost?", a: "One page is $497 flat. Five pages is $1,497." },
    { q: "How fast can it be live?", a: "One-page sites go live within 7 days of the kickoff call." },
  ],
});
check("KB ingested", seeded.statusCode === 200);

const status2 = json(await dispatch("GET", "/api/status"));
check("vector embeddings live", status2.integrations.embeddings === true && status2.knowledge.mode === "embeddings", `mode=${status2.knowledge.mode} chunks=${status2.knowledge.chunks}`);

console.log("-- agent: pricing question");
const q1 = await dispatch("POST", "/api/agent", { sessionId: "live-agent", leadId: lead.id, message: "How much would a one page website cost me?" });
const r1 = json(q1);
check("engine is mistral-tools", r1.engine === "mistral-tools", `engine=${r1.engine}`);
check("answer mentions $497", /497/.test(r1.reply ?? ""));
console.log(`  Jamie: ${(r1.reply ?? "").slice(0, 140)}`);
console.log(`  tools: ${(r1.toolsUsed ?? []).join(", ") || "none"}`);

console.log("-- agent: buy intent");
const q2 = await dispatch("POST", "/api/agent", { sessionId: "live-agent", leadId: lead.id, message: "Great, I want to buy the one page site. Send me the payment link." });
const r2 = json(q2);
check("create_checkout fired", (r2.toolsUsed ?? []).includes("create_checkout"), `tools=${(r2.toolsUsed ?? []).join(",")}`);
console.log(`  Jamie: ${(r2.reply ?? "").slice(0, 140)}`);

console.log("-- agent: booking");
const q3 = await dispatch("POST", "/api/agent", { sessionId: "live-agent", leadId: lead.id, message: "Actually, can we hop on a call first tomorrow morning?" });
const r3 = json(q3);
check("booking answered", (r3.reply ?? "").length > 10, "reply received");
console.log(`  Jamie: ${(r3.reply ?? "").slice(0, 140)}`);
console.log(`  tools: ${(r3.toolsUsed ?? []).join(", ") || "none"}`);

console.log("-- audit");
const auditRes = await dispatch("POST", "/api/audit", { url: "https://example.com" });
const aud = json(auditRes).audit;
check("live audit works", Boolean(aud), `reachable=${aud?.reachable} score=${aud?.score}ms=${aud?.responseMs}`);

console.log("-- AI site");
const siteRes = await dispatch("POST", "/api/site", { leadId: lead.id });
const s = json(siteRes);
check("AI copy used", s.copySource === "ai", `copySource=${s.copySource} template=${s.template}`);
const siteHtml = fs.readFileSync(`public${s.siteUrl}`, "utf8");
console.log(`  headline: ${(siteHtml.match(/<h1>([^<]+)/)?.[1] ?? "").slice(0, 90)}`);

console.log("-- AI SEO pack");
const seo = json(await dispatch("POST", "/api/seo", { leadId: lead.id })).seo;
check("AI SEO pack", seo?.source === "ai", `title="${(seo?.metaTitle ?? "").slice(0, 60)}" keywords=${seo?.keywords?.length}`);

console.log("-- AI GBP pack");
const gbp = json(await dispatch("POST", "/api/gbp", { leadId: lead.id })).pack;
check("AI GBP pack", gbp?.source === "ai" && gbp.checklist.length >= 5, `${gbp?.checklist?.length} steps, source=${gbp?.source}`);

console.log("-- email channel (preview send, no SMTP)");
const mail = await dispatch("POST", "/api/agent/email", { leadId: lead.id, from: "owner@example.com", text: "Is the $497 one-time or monthly?" });
const m = json(mail);
check("email channel live reply", mail.statusCode === 200 && (m.reply ?? "").length > 10, JSON.stringify(m.reply ?? "").slice(0, 90));

storeLib.resetStore();
console.log("======================================================================");
console.log(failures === 0 ? "LIVE_OK — all live checks passed" : `LIVE_HAD_FAILURES — ${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
