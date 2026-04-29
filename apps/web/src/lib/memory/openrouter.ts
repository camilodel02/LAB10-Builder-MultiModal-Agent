import type { MemoryType } from "@agents/types";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL = "openai/gpt-4o-mini";
const OPENROUTER_EMBED_MODEL = "openai/text-embedding-3-small";

type ExtractedMemory = { memory_type: MemoryType; content: string };

function getOpenRouterHeaders() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY");
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://agents.local",
  };
}

export function redactSensitiveText(input: string): string {
  return input
    .replace(/(sb_secret_[A-Za-z0-9\-_]+)/g, "[REDACTED]")
    .replace(/(sb_publishable_[A-Za-z0-9\-_]+)/g, "[REDACTED]")
    .replace(/(sk-or-v1-[A-Za-z0-9]+)/g, "[REDACTED]")
    .replace(/(Bearer\s+[A-Za-z0-9\-_.=]+)/gi, "[REDACTED]");
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const headers = getOpenRouterHeaders();
  const res = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: OPENROUTER_EMBED_MODEL,
      input: text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter embeddings ${res.status}: ${body}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ embedding?: number[] }>;
  };
  const embedding = json.data?.[0]?.embedding;
  if (!embedding || embedding.length === 0) {
    throw new Error("OpenRouter embeddings returned empty vector");
  }
  return embedding;
}

export async function extractStableMemories(params: {
  serializedSession: string;
  maxItems: number;
}): Promise<ExtractedMemory[]> {
  const headers = getOpenRouterHeaders();
  const prompt = [
    "Extrae recuerdos útiles para futuras sesiones de un agente.",
    "Reglas estrictas:",
    "- Solo información que probablemente seguirá siendo verdad.",
    "- Excluye relleno, saludos y detalles triviales temporales.",
    "- Clasifica cada item como episodic, semantic o procedural.",
    "- Máximo de items solicitado por el usuario del sistema.",
    "- Si no hay recuerdos valiosos, devuelve lista vacía.",
    "Devuelve SOLO JSON con forma: {\"memories\":[{\"memory_type\":\"episodic|semantic|procedural\",\"content\":\"...\"}]}",
    "",
    `Máximo de items: ${params.maxItems}`,
    "",
    "Transcripción de la sesión:",
    params.serializedSession,
  ].join("\n");

  const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter extraction ${res.status}: ${body}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content) as {
      memories?: Array<{ memory_type?: string; content?: string }>;
    };
    const allowed: MemoryType[] = ["episodic", "semantic", "procedural"];
    return (parsed.memories ?? [])
      .map((m) => ({
        memory_type: (m.memory_type ?? "") as MemoryType,
        content: redactSensitiveText((m.content ?? "").trim()),
      }))
      .filter(
        (m) =>
          allowed.includes(m.memory_type) &&
          m.content.length > 0 &&
          m.content.length <= 500
      );
  } catch {
    return [];
  }
}
