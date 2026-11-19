const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    $(`panel-${tab.dataset.tab}`).classList.add("active");
    if (tab.dataset.tab !== "leads") refreshLeads();
  });
});

async function post(path, body) {
  const res = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function note(text, kind = "ok-note") {
  return `<div class="note ${kind}">${text}</div>`;
}

function badge(score) {
  const cls = score >= 75 ? "b-high" : score >= 50 ? "b-mid" : "b-low";
  return `<span class="badge ${cls}" title="marketing-need score">need ${score}</span>`;
}

function siteLink(l) {
  return l.website ? `<a href="${esc(l.website)}" target="_blank" rel="noopener">site</a>` : `<em>no site</em>`;
}

let leadsCache = [];

async function refreshLeads() {
  const res = await fetch("/api/leads").catch(() => null);
  if (!res || !res.ok) return;
  const data = await res.json();
  leadsCache = data.leads ?? [];
  for (const sel of ["a-lead", "w-lead", "s-lead", "o-lead", "c-lead"]) {
    const el = $(sel);
    const current = el.value;
    el.innerHTML =
      '<option value="">— choose lead —</option>' +
      leadsCache
        .map(
          (l) =>
            `<option value="${esc(l.id)}">#${l.score} — ${esc(l.name)} (${esc(l.category)}, ${esc(l.city)})</option>`,
        )
        .join("");
    if (current) el.value = current;
  }
}

$("btn-search").addEventListener("click", async () => {
  const btn = $("btn-search");
  const out = $("leads-out");
  btn.disabled = true;
  out.innerHTML = note("Searching…", "warn");
  try {
    const data = await post("/leads/search", {
      category: $("q-cat").value.trim(),
      city: $("q-city").value.trim(),
      limit: Number($("q-limit").value) || 10,
    });
    const rows = data.leads
      .map(
        (l) =>
          `<tr><td><strong>${esc(l.name)}</strong><br><small>${esc(l.address || l.city)}</small></td>` +
          `<td>${esc(l.category)}</td><td>${siteLink(l)}</td>` +
          `<td>${l.rating !== undefined ? `★ ${l.rating} (${l.reviews ?? 0})` : "—"}</td>` +
          `<td>${badge(l.score)}</td><td><code>${esc(l.id.slice(0, 8))}</code></td></tr>`,
      )
      .join("");
    out.innerHTML =
      note(`Found ${data.leads.length} leads via <strong>${data.source === "demo" ? "DEMO data (add GOOGLE_PLACES_API_KEY for live search)" : "Google Places"}</strong>. Sorted by marketing need.`, data.source === "demo" ? "warn" : "ok-note") +
      `<table><thead><tr><th>Business</th><th>Industry</th><th>Website</th><th>Reviews</th><th>Opportunity</th><th>Lead</th></tr></thead><tbody>${rows}</tbody></table>`;
    await refreshLeads();
  } catch (err) {
    out.innerHTML = note(err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

$("btn-audit").addEventListener("click", async () => {
  const btn = $("btn-audit");
  const out = $("audit-out");
  const leadId = $("a-lead").value;
  const url = $("a-url").value.trim();
  if (!leadId && !url) {
    out.innerHTML = note("Pick a lead or enter a URL first.", "err");
    return;
  }
  btn.disabled = true;
  out.innerHTML = note("Auditing site…", "warn");
  try {
    const data = await post("/audit", { leadId: leadId || undefined, url: url || undefined });
    const a = data.audit;
    const rows = a.checks
      .map((c) => `<tr><td>${c.pass ? "✅" : "❌"} ${esc(c.label)}</td><td>${esc(c.detail)}</td></tr>`)
      .join("");
    out.innerHTML =
      note(
        `<strong>${a.reachable ? "Site OK" : "Site down"}</strong> — audit score ${a.score}/100 · opportunity score ${data.score}${data.label ? ` (${esc(data.label)})` : ""} · loaded in ${(a.responseMs / 1000).toFixed(1)}s/${a.checks.filter((c) => c.pass).length} checks passed ${a.url ? `· <a href="${esc(a.url)}" target="_blank" rel="noopener">open</a>` : ""}`,
        a.score >= 70 ? "ok-note" : "warn",
      ) +
      `<table><thead><tr><th>Check</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>` +
      (a.recommendations.length ? `<p class="hint" style="margin-top:12px"><strong>Recommends:</strong><br>${a.recommendations.map(esc).join("<br>")}</p>` : "");
  } catch (err) {
    out.innerHTML = note(err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

async function loadTemplates() {
  try {
    const res = await fetch("/api/templates");
    const data = await res.json();
    const sel = $("w-template");
    for (const t of data.templates ?? []) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    }
  } catch {}
}

$("w-template").addEventListener("change", () => {
  const sel = $("w-template");
  if (sel.value) sel.title = `Forces the ${sel.options[sel.selectedIndex].text} layout`;
});

$("btn-site").addEventListener("click", async () => {
  const btn = $("btn-site");
  const out = $("site-out");
  const leadId = $("w-lead").value;
  if (!leadId) {
    out.innerHTML = note("Pick a lead first (search leads in step 1).", "err");
    return;
  }
  const template = $("w-template").value || undefined;
  btn.disabled = true;
  out.innerHTML = note("Generating website…", "warn");
  try {
    const data = await post("/site", { leadId, template });
    out.innerHTML = note(
      `Website built with <strong>${esc(data.template ?? "auto")}</strong> template, copy by <strong>${data.copySource === "ai" ? "Mistral AI" : "built-in templates"}</strong> → <a href="${esc(data.siteUrl)}" target="_blank" rel="noopener">${esc(data.siteUrl)}</a>`,
      "ok-note",
    );
  } catch (err) {
    out.innerHTML = note(err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

$("btn-seo").addEventListener("click", async () => {
  const btn = $("btn-seo");
  const out = $("seo-out");
  const leadId = $("s-lead").value;
  if (!leadId) {
    out.innerHTML = note("Pick a lead first (search leads in step 1).", "err");
    return;
  }
  btn.disabled = true;
  out.innerHTML = note("Generating SEO pack…", "warn");
  try {
    const data = await post("/seo", { leadId });
    const s = data.seo;
    out.innerHTML =
      note(`SEO pack ready (<strong>${s.source === "ai" ? "Mistral AI" : "heuristic fallback"}</strong>).`, "ok-note") +
      `<div class="row">
        <div><label>Meta title</label><pre>${esc(s.metaTitle)}</pre></div>
        <div><label>Meta description</label><pre>${esc(s.metaDescription)}</pre></div>
      </div>
      <label>Keywords</label><pre>${esc((s.keywords ?? []).join(", "))}</pre>
      <label>Google Business post ideas</label><pre>${esc((s.postIdeas ?? []).map((i, n) => `${n + 1}. ${i}`).join("\n"))}</pre>
      <label>Prioritized improvements</label><pre>${esc((s.improvements ?? []).map((i, n) => `${n + 1}. ${i}`).join("\n"))}</pre>`;
  } catch (err) {
    out.innerHTML = note(err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

$("btn-outreach").addEventListener("click", async () => {
  const btn = $("btn-outreach");
  const out = $("outreach-out");
  const leadId = $("o-lead").value;
  if (!leadId) {
    out.innerHTML = note("Pick a lead first (search leads in step 1).", "err");
    return;
  }
  btn.disabled = true;
  out.innerHTML = note("Preparing outreach…", "warn");
  try {
    const email = $("o-email").value.trim();
    const sms = $("o-sms").value.trim();
    const data = await post("/responder", { leadId, email: email || undefined, sms: sms || undefined });
    const sentBits = data.sent
      ? Object.entries(data.sent)
          .map(([ch, r]) => `${ch}: ${r.ok ? "✅ sent via " + esc(r.provider) : "⚠️ " + esc(r.detail)}`)
          .join("<br>")
      : "";
    out.innerHTML =
      note(data.mode === "preview" ? "Preview draft (no recipients given)." : `Outreach processed.<br>${sentBits}`, data.mode === "preview" ? "warn" : "ok-note") +
      `<label>Email subject</label><pre>${esc(data.draft.email.subject)}</pre>
       <label>Email body</label><pre>${esc(data.draft.email.body)}</pre>
       <label>SMS body</label><pre>${esc(data.draft.sms.body)}</pre>`;
  } catch (err) {
    out.innerHTML = note(err.message, "err");
  } finally {
    btn.disabled = false;
  }
});

function clientNote(html, kind = "ok-note") {
  $("client-out").innerHTML = note(html, kind);
}

$("btn-report").addEventListener("click", async () => {
  const leadId = $("c-lead").value;
  if (!leadId) return clientNote("Pick a client lead first.", "err");
  clientNote("Building + emailing the monthly report…", "warn");
  try {
    const data = await post("/report", { leadId, send: true });
    clientNote(
      `${data.ok ? "Report sent" : "Report generated but <em>not sent</em>: ${esc(data.detail)}"} — audit score <strong>${data.report.auditScore ?? "—"}</strong>, ${data.report.activity.siteLeads} site leads, ${data.report.activity.payments} payments.`,
    );
  } catch (err) {
    clientNote(err.message, "err");
  }
});

$("btn-gbp").addEventListener("click", async () => {
  const leadId = $("c-lead").value;
  if (!leadId) return clientNote("Pick a client lead first.", "err");
  clientNote("Building the Google Business Profile pack…", "warn");
  try {
    const data = await post("/gbp", { leadId });
    const p = data.pack;
    clientNote(
      `<strong>GBP pack (${esc(p.source)}, ${p.checklist.length} steps)</strong><ol>${p.checklist.map((c) => `<li>${esc(c)}</li>`).join("")}</ol><strong>Weekly post ideas:</strong><br>${p.postIdeas.map((i) => `• ${esc(i)}`).join("<br>")}`,
    );
  } catch (err) {
    clientNote(err.message, "err");
  }
});

$("btn-ads").addEventListener("click", async () => {
  const leadId = $("c-lead").value;
  if (!leadId) return clientNote("Pick a client lead first.", "err");
  clientNote("Auditing their ads for waste (answering 'no' where you don't know = assume gap)…", "warn");
  try {
    const data = await post("/ads-audit", { monthlySpend: Number(prompt("Monthly ad spend in $ (0 if unsure)?")) || 0 });
    clientNote(
      `<strong>Health: ${data.score}/100.</strong> ${esc(data.verdict)}${data.estimatedMonthlyWaste > 0 ? ` Estimated waste: <strong>~$${data.estimatedMonthlyWaste}/mo</strong>.` : ""}<ul>${data.findings.map((f) => `<li>[${f.severity}] <strong>${esc(f.title)}</strong> — ${esc(f.detail)}</li>`).join("")}</ul>Pitch: <em>${esc(data.pitch)}</em>`,
    );
  } catch (err) {
    clientNote(err.message, "err");
  }
});

$("btn-review").addEventListener("click", async () => {
  const leadId = $("c-lead").value;
  const phone = $("rv-phone").value.trim();
  if (!leadId || !phone) return clientNote("Pick a client lead and enter the customer's phone.", "err");
  clientNote("Sending review link…", "warn");
  try {
    const data = await post("/reviews/request", { leadId, customerPhone: phone, customerName: $("rv-name").value.trim() || undefined });
    clientNote(`Review link: <a href="${esc(data.link)}" target="_blank" rel="noopener">${esc(data.link)}</a> — send: ${data.sent.ok ? "sent" : `preview only (${esc(data.sent.provider)})`}`);
  } catch (err) {
    clientNote(err.message, "err");
  }
});

refreshLeads();
loadTemplates();
fetch("/api/status")
  .then((r) => r.json())
  .then((s) => {
    const i = s.integrations;
    document.querySelector("header h1").title = `mistral: ${i.mistral ? "on" : "off"} · places: ${i.googlePlaces ? "live" : "demo"} · twilio: ${i.twilio ? "on" : "off"} · smtp: ${i.smtp ? "on" : "off"}`;
  });
