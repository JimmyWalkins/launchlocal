import { cosineSim, embedTexts, embeddingsAvailable, keywordOverlap, type Embedding } from "./embed.ts";
import { getKb, type Audit } from "./store.ts";

export type ChunkKind = "offer" | "faq" | "audit" | "conversation";

export interface Chunk {
  id: string;
  kind: ChunkKind;
  leadId?: string;
  sessionId?: string;
  text: string;
  embedding?: Embedding;
}

export interface RetrievedChunk {
  kind: ChunkKind;
  text: string;
  score: number;
  scope: string;
}

const chunks: Chunk[] = [];
let seq = 0;

export function knowledgeMode(): "embeddings" | "keywords" {
  return embeddingsAvailable() ? "embeddings" : "keywords";
}

export function knowledgeStats() {
  return {
    chunks: chunks.length,
    mode: knowledgeMode(),
    byKind: chunks.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.kind]: (acc[c.kind] ?? 0) + 1 }), {}),
  };
}

interface Scope {
  leadId?: string;
  sessionId?: string;
}

function matchesScope(c: Chunk, s: Scope): boolean {
  if (c.leadId && s.leadId && c.leadId !== s.leadId) return false;
  if (c.sessionId && s.sessionId && c.sessionId !== s.sessionId) return false;
  return true;
}

async function replaceScope(kind: ChunkKind, scope: Scope, texts: string[]): Promise<void> {
  const clean = texts.map((t) => t.trim()).filter(Boolean);
  chunks.splice(
    0,
    chunks.length,
    ...chunks.filter((c) => !(c.kind === kind && (c.leadId ?? "") === (scope.leadId ?? "") && (c.sessionId ?? "") === (scope.sessionId ?? ""))),
  );
  if (!clean.length) return;
  const embeddings = await embedTexts(clean);
  clean.forEach((text, i) => {
    chunks.push({ id: `c${++seq}`, kind, leadId: scope.leadId, sessionId: scope.sessionId, text, embedding: embeddings?.[i] });
  });
}

export async function ingestOffer(): Promise<void> {
  const kb = getKb();
  const parts = [
    kb.brand ? `Brand: ${kb.brand}` : "",
    kb.offer ? `Current offer: ${kb.offer}` : "",
  ].filter(Boolean);
  await replaceScope("offer", {}, parts);
}

export async function ingestFaqs(): Promise<void> {
  const kb = getKb();
  await replaceScope("faq", {}, kb.faqs.map((f) => `Q: ${f.q}\nA: ${f.a}`));
}

export async function ingestAudit(leadId: string, leadName: string, audit: Audit): Promise<void> {
  const summary =
    `Website audit for ${leadName} (${audit.url}): audit score ${audit.score}/100, site ${audit.reachable ? "reachable" : "unreachable"}, ` +
    `loaded in ${(audit.responseMs / 1000).toFixed(1)}s. ` +
    `Failed checks: ${audit.checks.filter((c) => !c.pass).map((c) => c.label).join("; ") || "none"}. ` +
    `Recommendations: ${audit.recommendations.join("; ") || "none"}.`;
  await replaceScope("audit", { leadId }, [summary]);
}

export async function recordTurn(sessionId: string, leadId: string | undefined, role: "user" | "assistant", content: string): Promise<void> {
  if (!content.trim()) return;
  const embedding = (await embedTexts([content]))?.[0];
  chunks.push({ id: `c${++seq}`, kind: "conversation", leadId, sessionId, text: `${role}: ${content}`, embedding });
  if (chunks.length > 500) {
    const oldConversation = chunks.find((c) => c.kind === "conversation");
    if (oldConversation) chunks.splice(chunks.indexOf(oldConversation), 1);
  }
}

export async function reindexAll(): Promise<void> {
  await Promise.all([ingestOffer(), ingestFaqs()]);
}

export async function searchKnowledge(query: string, scope: Scope = {}, k = 4): Promise<RetrievedChunk[]> {
  const pool = chunks.filter((c) => matchesScope(c, scope));
  if (!pool.length) return [];

  const queryEmbedding = (await embedTexts([query]))?.[0];
  const scored: RetrievedChunk[] = pool.map((c) => {
    const useVector = Boolean(queryEmbedding && c.embedding);
    const score = useVector ? cosineSim(queryEmbedding!, c.embedding!) : keywordOverlap(query, c.text);
    return {
      kind: c.kind,
      text: c.text,
      score,
      scope: c.sessionId ? `session ${c.sessionId.slice(0, 8)}` : c.leadId ? `lead ${c.leadId.slice(0, 8)}` : c.kind,
    };
  });
  return scored
    .filter((c) => c.score > 0.03)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
