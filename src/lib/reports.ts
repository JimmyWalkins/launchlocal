import { findContactEmail, getLead, listLeads, saveStore, updateLead, type Lead } from "./store.ts";
import { sendEmail } from "./notify.ts";

const WEEK_MS = 7 * 86_400_000;

export interface ClientReport {
  leadId: string;
  business: string;
  siteTitle: string;
  summary: string[];
  auditScore?: number;
  topRecommendations: string[];
  activity: { followUps: number; outreachMessages: number; siteLeads: number; payments: number };
  siteUrl?: string;
}

function siteLeadsFor(lead: Lead): number {
  return (lead.timeline ?? []).filter((t) => t.event === "site_lead_in").length;
}

export function buildReport(lead: Lead): ClientReport {
  const audit = lead.audit;
  const seo = lead.seo;
  const timeline = lead.timeline ?? [];
  const summary = [
    audit ? `Latest website audit score: ${audit.score}/100 (checked ${audit.checks.filter((c) => c.pass).length}/${audit.checks.length} points).` : "No website audit yet — reply to this email and we'll run one.",
    lead.siteUrl ? `Your site is live at ${lead.siteUrl}.` : "Your one-page site hasn't been generated yet — we can have it live within 7 days.",
    seo?.metaTitle ? `SEO title in place: "${seo.metaTitle}".` : "SEO pack not built yet.",
    `${timeline.filter((t) => t.event === "sequence_step_sent").length} follow-up touches and ${siteLeadsFor(lead)} leads captured from your site so far.`,
  ];
  const topRecommendations = (audit?.recommendations ?? []).slice(0, 3);
  return {
    leadId: lead.id,
    business: lead.name,
    siteTitle: seo?.metaTitle || `${lead.name} — ${lead.city}`,
    summary,
    auditScore: audit?.score,
    topRecommendations,
    activity: {
      followUps: timeline.filter((t) => t.event.startsWith("sequence")).length,
      outreachMessages: (lead.outreach ?? []).length,
      siteLeads: siteLeadsFor(lead),
      payments: timeline.filter((t) => t.event === "payment_received").length,
    },
    siteUrl: lead.siteUrl,
  };
}

export function renderReportText(report: ClientReport): string {
  const lines = [
    `Monthly progress report — ${report.business}`,
    "",
    ...report.summary,
  ];
  if (report.topRecommendations.length) {
    lines.push("", "Top fixes in progress:");
    for (const rec of report.topRecommendations) lines.push(`- ${rec}`);
  }
  lines.push("", "Questions or want to adjust the plan? Just reply to this email.");
  lines.push("", "— Launch Local 661, Bakersfield");
  return lines.join("\n");
}

export async function sendReport(leadId: string): Promise<{ ok: boolean; detail: string; report: ClientReport }> {
  const lead = getLead(leadId);
  if (!lead) throw new Error("unknown lead");
  const report = buildReport(lead);
  const to = findContactEmail(leadId) ?? process.env.CLIENT_ALERT_EMAIL?.trim() ?? undefined;
  if (!to) {
    return { ok: false, detail: "No client email on file (have them chat with the agent once, or set CLIENT_ALERT_EMAIL). Report generated only.", report };
  }
  const outcome = await sendEmail(to, `Your Launch Local 661 monthly report — ${lead.name}`, renderReportText(report));
  updateLead(lead.id, {
    lastReportAt: new Date().toISOString(),
    timeline: [...(lead.timeline ?? []), { ts: new Date().toISOString(), event: "report_sent", detail: `Monthly report to ${to} (${outcome.provider})` }],
  });
  saveStore();
  return { ok: outcome.ok, detail: outcome.ok ? `Report emailed to ${to} via ${outcome.provider}.` : outcome.detail, report };
}

export async function tickReports(now = Date.now()): Promise<{ sent: number }> {
  let sent = 0;
  for (const lead of listLeads()) {
    if (lead.status !== "won") continue;
    if (lead.lastReportAt && now - Date.parse(lead.lastReportAt) < WEEK_MS) continue;
    const to = findContactEmail(lead.id) ?? process.env.CLIENT_ALERT_EMAIL?.trim() ?? undefined;
    if (!to) continue;
    const report = buildReport(lead);
    const outcome = await sendEmail(to, `Your Launch Local 661 monthly report — ${lead.name}`, renderReportText(report));
    updateLead(lead.id, {
      lastReportAt: new Date().toISOString(),
      timeline: [...(lead.timeline ?? []), { ts: new Date().toISOString(), event: "report_sent", detail: `${to} (${outcome.provider})` }],
    });
    sent++;
  }
  if (sent) saveStore();
  return { sent };
}
