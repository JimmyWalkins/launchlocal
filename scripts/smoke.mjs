import assert from "node:assert/strict";
import fs from "node:fs";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { app } from "../src/server.ts";
import { resetStore } from "../src/lib/store.ts";

resetStore();

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

function mockReq(method, url, body) {
  const payload = body ? Buffer.from(JSON.stringify(body)) : Buffer.from("");
  const req = Readable.from([payload]);
  req.method = method;
  req.url = url;
  req.headers = body
    ? { "content-type": "application/json", "content-length": payload.length.toString() }
    : {};
  req.socket = { remoteAddress: "127.0.0.1" };
  return req;
}

function dispatch(method, url, body) {
  return new Promise((resolve) => {
    const res = mockRes();
    res.on("finish", () => resolve(res));
    app.handle(mockReq(method, url, body), res);
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
resetStore();
process.exit(0);
