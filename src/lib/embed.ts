import { config } from "./config.ts";

export type Embedding = number[];

export function cosineSim(a: Embedding, b: Embedding): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function embeddingsAvailable(): boolean {
  return Boolean(config.mistralKey);
}

export async function embedTexts(texts: string[]): Promise<Embedding[] | null> {
  if (!texts.length) return [];
  if (!config.mistralKey) return null;
  try {
    const { Mistral } = await import("@mistralai/mistralai");
    const client = new Mistral({ apiKey: config.mistralKey });
    const res = await client.embeddings.create({ model: "mistral-embed", inputs: texts.map((t) => t.slice(0, 8000)) });
    return res.data?.map((d) => d.embedding as unknown as Embedding) ?? null;
  } catch {
    return null;
  }
}

const tokenize = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((t) => t.length > 2);

export function keywordOverlap(query: string, text: string): number {
  const q = new Set(tokenize(query));
  if (!q.size) return 0;
  const t = tokenize(text);
  let hits = 0;
  for (const term of q) if (t.includes(term)) hits++;
  return hits / q.size;
}
