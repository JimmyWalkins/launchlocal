import { Mistral } from "@mistralai/mistralai";
import { config } from "./config.ts";

let cached: Mistral | null | undefined;

function client(): Mistral | null {
  if (cached === undefined) {
    cached = config.mistralKey ? new Mistral({ apiKey: config.mistralKey }) : null;
  }
  return cached;
}

export function aiAvailable(): boolean {
  return client() !== null;
}

export async function aiText(system: string, prompt: string): Promise<string | null> {
  const c = client();
  if (!c) return null;
  try {
    const res = await c.chat.complete({
      model: "mistral-small-latest",
      messages: [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        { role: "user" as const, content: prompt },
      ],
    });
    const raw = res.choices?.[0]?.message?.content ?? "";
    return typeof raw === "string" ? raw : raw.map((chunk) => (chunk.type === "text" ? chunk.text : "")).join("");
  } catch {
    return null;
  }
}

export async function aiJson<T>(system: string, prompt: string): Promise<T | null> {
  const text = await aiText(system, `${prompt}\n\nRespond with valid JSON only, no markdown fences.`);
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
