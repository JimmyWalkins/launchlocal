import { sendEmail, sendSms } from "./notify.ts";
import {
  getKb,
  getLead,
  listConversations,
  listEnrollments,
  saveEnrollment,
  saveStore,
  updateLead,
  type Enrollment,
  type Lead,
  type SequenceStepState,
} from "./store.ts";

const DAY_MS = 86_400_000;

interface StepDef {
  day: number;
  channel: "email" | "sms";
  label: string;
  subject: string;
  body: (lead: Lead, offer: string) => string;
}

export const SEQUENCES: Record<string, StepDef[]> = {
  standard: [
    {
      day: 1,
      channel: "email",
      label: "day 1 email: audit recap",
      subject: "Your free marketing audit",
      body: (lead, offer) =>
        `Hi ${lead.name} team - following up on the free audit we ran for ${lead.name} in ${lead.city}.${offer ? ` Quick reminder of what we do: ${offer}` : ""} Want the full report? Just reply to this email.`,
    },
    {
      day: 3,
      channel: "sms",
      label: "day 3 SMS: quick nudge",
      subject: "",
      body: (lead) =>
        `Launch Local 661 here - your free marketing audit for ${lead.name} is ready. Want the link + a 10-min walkthrough? Reply YES and we'll send it over.`,
    },
    {
      day: 7,
      channel: "email",
      label: "day 7 email: final nudge",
      subject: "Last nudge, then I'll leave you alone",
      body: (lead, offer) =>
        `Hi ${lead.name} - last note from Launch Local 661. If fixing ${lead.name}'s online presence isn't a priority right now, no worries at all. If it is, ${offer || "we can start with the free audit"} and most sites go live within 7 days. Reply anytime.`,
    },
  ],
};

function findEmailFor(leadId: string): string | undefined {
  const conv = listConversations().find((c) => c.leadId === leadId && c.contact?.email);
  return conv?.contact?.email;
}

export function enrollLead(leadId: string, seqName = "standard"): { ok: true; enrollment: Enrollment } | { ok: false; error: string } {
  const lead = getLead(leadId);
  if (!lead) return { ok: false, error: "Unknown leadId" };
  const defs = SEQUENCES[seqName];
  if (!defs) return { ok: false, error: `Unknown sequence '${seqName}'. Available: ${Object.keys(SEQUENCES).join(", ")}` };
  const active = listEnrollments().find((e) => e.leadId === leadId && e.seqName === seqName && e.status === "active");
  if (active) return { ok: false, error: `Lead is already enrolled in the '${seqName}' sequence` };
  const now = Date.now();
  const enrollment: Enrollment = {
    id: `seq_${leadId}_${seqName}_${now.toString(36)}`,
    leadId,
    seqName,
    status: "active",
    enrolledAt: new Date(now).toISOString(),
    steps: defs.map(
      (def): SequenceStepState => ({
        day: def.day,
        channel: def.channel,
        label: def.label,
        status: "pending",
        dueAt: new Date(now + def.day * DAY_MS).toISOString(),
      }),
    ),
  };
  saveEnrollment(enrollment);
  const timeline = [
    ...(lead.timeline ?? []),
    { ts: new Date(enrollment.enrolledAt).toISOString(), event: "sequence_enrolled", detail: `${seqName}: ${enrollment.steps.length} follow-ups scheduled` },
  ];
  updateLead(leadId, { timeline });
  saveStore();
  return { ok: true, enrollment };
}

export async function tickSequences(now = Date.now()): Promise<{ checked: number; sent: number; skipped: number }> {
  const offer = getKb().offer ?? "";
  let sent = 0;
  let skipped = 0;
  for (const enrollment of listEnrollments()) {
    if (enrollment.status !== "active") continue;
    let touched = false;
    for (const step of enrollment.steps) {
      if (step.status !== "pending") continue;
      if (Date.parse(step.dueAt) > now) continue;
      const lead = getLead(enrollment.leadId);
      if (!lead) {
        step.status = "skipped";
        step.detail = "lead no longer exists";
        skipped++;
        touched = true;
        continue;
      }
      if (lead.status === "won" || lead.status === "lost") {
        step.status = "skipped";
        step.detail = `lead status is ${lead.status}`;
        skipped++;
        touched = true;
        continue;
      }
      const def = SEQUENCES[enrollment.seqName]?.find((d) => d.day === step.day && d.channel === step.channel);
      if (!def) {
        step.status = "skipped";
        step.detail = "step definition missing";
        skipped++;
        touched = true;
        continue;
      }
      if (step.channel === "email") {
        const to = findEmailFor(lead.id);
        if (!to) {
          step.status = "skipped";
          step.detail = "no email address on file for lead";
          skipped++;
          touched = true;
          continue;
        }
        const body = def.body(lead, offer);
        const outcome = await sendEmail(to, def.subject, body);
        step.status = "sent";
        step.sentAt = new Date().toISOString();
        step.detail = outcome.detail;
        updateLead(lead.id, {
          outreach: [...(lead.outreach ?? []), { channel: "email", to, sentAt: step.sentAt, provider: outcome.provider, ok: outcome.ok, body }],
          timeline: [...(lead.timeline ?? []), { ts: step.sentAt, event: "sequence_step_sent", detail: `${enrollment.seqName} day ${step.day}: email to ${to} (${outcome.provider})` }],
        });
        sent++;
        touched = true;
      } else {
        const to = lead.phone;
        if (!to) {
          step.status = "skipped";
          step.detail = "no phone on file for lead";
          skipped++;
          touched = true;
          continue;
        }
        const body = def.body(lead, offer);
        const outcome = await sendSms(to, body);
        step.status = "sent";
        step.sentAt = new Date().toISOString();
        step.detail = outcome.detail;
        updateLead(lead.id, {
          outreach: [...(lead.outreach ?? []), { channel: "sms", to, sentAt: step.sentAt, provider: outcome.provider, ok: outcome.ok, body }],
          timeline: [...(lead.timeline ?? []), { ts: step.sentAt, event: "sequence_step_sent", detail: `${enrollment.seqName} day ${step.day}: SMS to ${to} (${outcome.provider})` }],
        });
        sent++;
        touched = true;
      }
    }
    if (touched) {
      const hasPending = enrollment.steps.some((s) => s.status === "pending");
      if (!hasPending) enrollment.status = "done";
      saveEnrollment(enrollment);
    }
  }
  if (sent || skipped) saveStore();
  return { checked: listEnrollments().length, sent, skipped };
}
