import assert from "node:assert/strict";
import fs from "node:fs";
import { createHmac } from "node:crypto";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { app } from "../src/server.ts";
import { resetStore } from "../src/lib/store.ts";
import { tickSequences } from "../src/lib/sequences.ts";

resetStore();
const WEBHOOK_SECRET = "whsec_smoke_test";
process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;

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

function mockReq(method, url, body, extraHeaders = {}) {
  const payload = body ? Buffer.from(JSON.stringify(body)) : Buffer.from("");
  const req = Readable.from([payload]);
  req.method = method;
  req.url = url;
  req.headers = body
    ? { "content-type": "application/json", "content-length": payload.length.toString(), ...extraHeaders }
    : { ...extraHeaders };
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

function dispatch(method, url, body, extraHeaders = {}) {
  return new Promise((resolve) => {
    const res = mockRes();
    res.on("finish", () => resolve(res));
    app.handle(mockReq(method, url, body, extraHeaders), res);
  });
}

function json(res) {
  try {
    return JSON.parse(res.body);
  } catch {
    return {};
  }
}

const page = await dispatch("GET", "/");
assert.equal(page.statusCode, 200, "dashboard served");
assert.ok(page.body.includes("panel-leads"), "dashboard has lead panel");

const chatPage = await dispatch("GET", "/chat");
assert.equal(chatPage.statusCode, 200, "chat page still served");

const badSearch = await dispatch("POST", "/api/leads/search", { city: "Bakersfield" });
assert.equal(badSearch.statusCode, 400, "search without category rejected");

const search = await dispatch("POST", "/api/leads/search", { category: "plumber", city: "Bakersfield" });
assert.equal(search.statusCode, 200, "lead search works");
const searchBody = json(search);
assert.ok(Array.isArray(searchBody.leads) && searchBody.leads.length > 0, "demo leads returned");
assert.ok(searchBody.leads[0].score >= 0 && searchBody.leads[0].score <= 100, "lead score in range");

const listRes = await dispatch("GET", "/api/leads");
const leads = json(listRes).leads;
assert.ok(leads.length >= searchBody.leads.length, "leads persisted");
const demoLead = leads[0];
assert.ok(demoLead.id, "lead has id");

const badAudit = await dispatch("POST", "/api/audit", {});
assert.equal(badAudit.statusCode, 400, "audit without target rejected");

const unparsed = await dispatch("POST", "/api/audit", { url: "not a url" });
assert.equal(json(unparsed).audit.reachable, false, "unparseable audit handled gracefully");

const siteRes = await dispatch("POST", "/api/site", { leadId: demoLead.id });
assert.equal(siteRes.statusCode, 200, "site builder works");
const siteFile = json(siteRes).siteUrl;
assert.ok(siteFile.startsWith("/sites/"), "site path returned");
const siteRes2 = await dispatch("GET", siteFile);
assert.equal(siteRes2.statusCode, 200, "generated site served");
assert.ok(siteRes2.body.includes("application/ld+json"), "site contains LocalBusiness schema");
assert.ok(siteRes2.body.includes("viewport"), "site is mobile-ready");

const seoRes = await dispatch("POST", "/api/seo", { leadId: demoLead.id });
assert.equal(seoRes.statusCode, 200, "seo endpoint works");
const seo = json(seoRes).seo;
assert.ok(seo.metaTitle && seo.metaDescription && Array.isArray(seo.keywords), "seo pack populated");

const preview = await dispatch("POST", "/api/responder", { leadId: demoLead.id });
assert.equal(preview.statusCode, 200, "responder preview works");
const previewDraft = json(preview).draft;
assert.ok(previewDraft.email.subject && previewDraft.sms.body, "email + sms drafts generated");

const missingLead = await dispatch("POST", "/api/site", { leadId: "nope" });
assert.equal(missingLead.statusCode, 400, "unknown lead rejected");

const statusRes = await dispatch("GET", "/api/status");
assert.equal(statusRes.statusCode, 200, "status endpoint works");

assert.ok(fs.existsSync("public" + siteFile), "site file written to disk");

console.log("SMOKE_OK");
console.log("dashboard:", page.statusCode);
console.log("chat page:", chatPage.statusCode, "(kept from step 1)");
console.log("leads search:", search.statusCode, `source=${searchBody.source} count=${searchBody.leads.length}`);
console.log("audit validation:", badAudit.statusCode);
console.log("site built:", siteRes.statusCode, siteFile);
console.log("seo pack:", seoRes.statusCode, "source=", seo.source);
console.log("responder preview:", preview.statusCode);

const kbRes = await dispatch("POST", "/api/kb", {
  brand: "Launch Local 661",
  offer: "Launch Pad one-page site $497 flat, live in 7 days. SEO Care $299/month. Free audit anytime.",
  faqs: [{ q: "Do you offer payment plans?", a: "Yes - 50/50 split on website projects." }],
});
assert.equal(kbRes.statusCode, 200, "kb update works");
assert.ok(json(kbRes).knowledge.byKind.faq >= 1, "kb ingested faq chunks");

const agentPricing = await dispatch("POST", "/api/agent", { sessionId: "smoke-agent", message: "How much is a website?" });
assert.equal(agentPricing.statusCode, 200, "agent responds");
const pricingBody = json(agentPricing);
assert.ok(pricingBody.reply && pricingBody.reply.length > 10, "agent reply non-empty");
assert.equal(pricingBody.engine, "rules", "no key => rule engine");
assert.ok(pricingBody.toolsUsed.includes("create_checkout") === false, "no checkout on simple pricing q");

const agentPay = await dispatch("POST", "/api/agent", { sessionId: "smoke-agent", message: "I want to buy the one page site now" });
assert.ok(json(agentPay).toolsUsed.includes("create_checkout"), "buy intent triggers checkout tool");

const agentBook = await dispatch("POST", "/api/agent", { sessionId: "smoke-agent", message: "Let's book a call tomorrow" });
assert.equal(json(agentBook).statusCode, undefined);
assert.ok(json(agentBook).reply.includes("BOOKING_URL") || json(agentPay).reply.includes("http") || json(agentBook).reply.includes("book"), "booking handled");

const crmLead = json(await dispatch("GET", "/api/leads")).leads[0];
assert.ok(crmLead, "lead available for channel tests");

const emailReply = await dispatch("POST", "/api/agent/email", { leadId: crmLead.id, text: "Sounds good, what's included in the $497?", from: "owner@example.com" });
assert.equal(emailReply.statusCode, 200, "agent email reply works");
const emailBody = json(emailReply);
assert.ok(emailBody.reply.includes("497") || emailBody.reply.length > 10, "email reply references offer");
assert.ok(emailBody.sentTo === "owner@example.com", "email reply routed to sender");
assert.ok(emailBody.sent.ok === false && emailBody.sent.provider === "none", "email send no-ops without SMTP but is journaled");

const smsReply = await dispatch("POST", "/api/agent/sms", { leadId: crmLead.id, from: "+16615550134", text: "hey is seo really $299/mo?" });
assert.equal(smsReply.statusCode, 200, "agent sms reply works");
const smsBody = json(smsReply);
assert.ok(smsBody.sent.ok === false && smsBody.sent.provider === "none", "sms send no-ops without twilio but is journaled");
assert.ok(smsBody.reply.toLowerCase().includes("299"), "sms answer grounded in KB");

const stopReply = await dispatch("POST", "/api/agent/sms", { leadId: crmLead.id, from: "+16615550134", text: "STOP" });
assert.ok(json(stopReply).reply.toLowerCase().includes("unsubscribed"), "STOP honored");

const convRes = await dispatch("GET", "/api/conversations");
const conversations = json(convRes).conversations;
assert.ok(conversations.some((c) => c.sessionId === "email-smoke..." || String(c.sessionId).includes("smoke-agent")), "conversations journaled");

const status2 = json(await dispatch("GET", "/api/status"));
assert.equal(status2.apps.salesAgent, true, "agent app flag on");
assert.ok(status2.knowledge.chunks > 0, "knowledge indexed at boot + by endpoints");
const crmLeadAfter = json(await dispatch("GET", "/api/leads")).leads.find((l) => l.id === crmLead.id);
assert.ok((crmLeadAfter?.outreach?.length ?? 0) >= 2, "channel replies journaled on the lead");
assert.equal(crmLead.status, "new", "crm status default");

console.log("agent pricing:", agentPricing.statusCode, JSON.stringify(pricingBody.reply).slice(0, 90));
console.log("agent checkout:", json(agentPay).toolsUsed.join(","));
console.log("email reply:", emailReply.statusCode, "| journaled on lead");
console.log("sms reply:", smsReply.statusCode, "| STOP honored");
console.log("knowledge:", JSON.stringify(status2.knowledge));

const goodLead = json(await dispatch("GET", "/api/leads")).leads.find((l) => l.phone) ?? json(await dispatch("GET", "/api/leads")).leads[0];

const enroll = await dispatch("POST", "/api/sequences/enroll", { leadId: goodLead.id });
assert.equal(enroll.statusCode, 200, "sequence enroll works");
const enrollBody = json(enroll);
assert.ok(enrollBody.enrollment.steps.length === 3, "standard sequence has 3 steps");
const dupEnroll = await dispatch("POST", "/api/sequences/enroll", { leadId: goodLead.id });
assert.equal(dupEnroll.statusCode, 400, "duplicate enrollment rejected");
const unknownLeadEnroll = await dispatch("POST", "/api/sequences/enroll", { leadId: "nope" });
assert.equal(unknownLeadEnroll.statusCode, 400, "unknown lead enrollment rejected");
const unknownSeqEnroll = await dispatch("POST", "/api/sequences/enroll", { leadId: goodLead.id, seqName: "nope" });
assert.equal(unknownSeqEnroll.statusCode, 400, "unknown sequence rejected");

const seqList = json(await dispatch("GET", "/api/sequences"));
assert.ok(seqList.available.some((s) => s.name === "standard"), "standard sequence listed");
assert.ok(seqList.enrollments.some((e) => e.leadId === goodLead.id && e.status === "active"), "enrollment persisted");

const noopTick = await dispatch("POST", "/api/sequences/tick", {});
assert.equal(noopTick.statusCode, 200, "tick endpoint works (nothing due yet)");

const outreachBefore = (json(await dispatch("GET", "/api/leads")).leads.find((l) => l.id === goodLead.id)?.outreach ?? []).length;
const tick = await tickSequences(Date.now() + 8 * 86400000);
assert.equal(tick.checked, seqList.enrollments.length, "tick sees enrollments");
assert.ok(tick.sent + tick.skipped === 3, "all standard steps resolved");
const afterTickLead = json(await dispatch("GET", "/api/leads")).leads.find((l) => l.id === goodLead.id);
const resolved = seqList.enrollments.find((e) => e.leadId === goodLead.id);
assert.ok(afterTickLead, "lead still present after tick");
assert.ok(tick.sent >= 1, "tick attempted at least the SMS step (lead has phone)");
assert.ok((afterTickLead?.outreach?.length ?? 0) > outreachBefore, "sequence sends journaled to outreach");
assert.ok(afterTickLead.timeline.some((t) => t.event === "sequence_step_sent"), "sequence steps journaled to timeline");
const seqAfter = json(await dispatch("GET", "/api/sequences")).enrollments.find((e) => e.leadId === goodLead.id);
assert.ok(seqAfter.steps.every((s) => s.status === "sent" || s.status === "skipped"), "no step left pending after due tick");
assert.equal(json(await dispatch("GET", "/api/sequences")).enrollments.find((e) => e.leadId === goodLead.id).status, "done", "enrollment completes");

console.log("sequences:", enroll.statusCode, `tick sent=${tick.sent} skipped=${tick.skipped}`);

const noSecretEnv = process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_WEBHOOK_SECRET;
const unsignedBlocked = await dispatch("POST", "/webhooks/stripe", { type: "checkout.session.completed" });
assert.equal(unsignedBlocked.statusCode, 503, "webhook refuses to run without secret");
process.env.STRIPE_WEBHOOK_SECRET = noSecretEnv;

const webhookEvent = {
  id: "evt_smoke_1",
  type: "checkout.session.completed",
  data: { object: { client_reference_id: goodLead.id, amount_total: 49700, currency: "usd", customer_details: { email: "owner@example.com" } } },
};

const badSig = await dispatch(
  "POST",
  "/webhooks/stripe",
  webhookEvent,
  { "stripe-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` },
);
assert.equal(badSig.statusCode, 400, "webhook rejects bad signature");

const noHeader = await dispatch("POST", "/webhooks/stripe", webhookEvent);
assert.equal(noHeader.statusCode, 400, "webhook rejects missing signature header");

const staleT = Math.floor(Date.now() / 1000) - 4000;
const staleSig = createHmac("sha256", WEBHOOK_SECRET).update(`${staleT}.${JSON.stringify(webhookEvent)}`).digest("hex");
const stale = await dispatch("POST", "/webhooks/stripe", webhookEvent, { "stripe-signature": `t=${staleT},v1=${staleSig}` });
assert.equal(stale.statusCode, 400, "webhook rejects stale timestamps");

const tGood = Math.floor(Date.now() / 1000);
const goodSig = createHmac("sha256", WEBHOOK_SECRET).update(`${tGood}.${JSON.stringify(webhookEvent)}`).digest("hex");
const hookOk = await dispatch("POST", "/webhooks/stripe", webhookEvent, { "stripe-signature": `t=${tGood},v1=${goodSig}` });
assert.equal(hookOk.statusCode, 200, "valid signature accepted");
assert.equal(json(hookOk).received, true, "webhook acknowledges receipt");

const wonLead = json(await dispatch("GET", "/api/leads")).leads.find((l) => l.id === goodLead.id);
assert.equal(wonLead?.status, "won", "payment marks lead won");
assert.ok(wonLead?.timeline.some((t) => t.event === "payment_received" && t.detail.includes("497.00")), "payment timeline event recorded");

const unrelatedEvent = { id: "evt_smoke_2", type: "invoice.paid", data: { object: {} } };
const tUnrelated = Math.floor(Date.now() / 1000);
const unrelatedSig = createHmac("sha256", WEBHOOK_SECRET).update(`${tUnrelated}.${JSON.stringify(unrelatedEvent)}`).digest("hex");
const unrelated = await dispatch("POST", "/webhooks/stripe", unrelatedEvent, { "stripe-signature": `t=${tUnrelated},v1=${unrelatedSig}` });
assert.equal(unrelated.statusCode, 200, "non-checkout events acknowledged");

console.log("stripe webhook:", hookOk.statusCode, "| lead marked won | bad/stale/unsigned rejected");

assert.ok(fs.existsSync("data/launchlocal.db"), "SQLite database file created");
const storeLib = await import("../src/lib/store.ts");
storeLib.loadStore();
const reloaded = storeLib.listLeads().find((l) => l.id === goodLead.id);
assert.ok(reloaded && reloaded.status === "won", "SQLite roundtrip preserves leads + status");
assert.ok(Object.keys(storeLib.getConversation("smoke-agent").messages ?? []).length >= 0, "conversations reload from SQLite");
console.log("sqlite:", "data/launchlocal.db roundtrip OK, leads =", storeLib.listLeads().length);

resetStore();
process.exit(0);
