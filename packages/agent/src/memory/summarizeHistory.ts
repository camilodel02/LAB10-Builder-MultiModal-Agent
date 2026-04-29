import { HumanMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import type { CompactionStats } from "./types";
import { redactSensitiveContent } from "./safety";

function serializeMessages(messages: BaseMessage[]): string {
  return messages
    .map((m) => {
      const role = m.getType();
      const content =
        typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return `[${role}] ${redactSensitiveContent(content)}`;
    })
    .join("\n");
}

export async function summarizeHistory(params: {
  model: {
    invoke: (messages: HumanMessage[]) => Promise<{ content: unknown }>;
  };
  currentSummary: string;
  historyChunk: BaseMessage[];
  stats: CompactionStats;
}): Promise<{ summary: string; stats: CompactionStats }> {
  if (params.historyChunk.length === 0) {
    return { summary: params.currentSummary, stats: params.stats };
  }

  const serializedChunk = serializeMessages(params.historyChunk);
  const existing = params.currentSummary || "(sin resumen previo)";

  const prompt = [
    "Eres un compactor de memoria para un agente conversacional.",
    "Actualiza el resumen acumulado manteniendo:",
    "- Perfil y preferencias estables del usuario.",
    "- Decisiones, tareas y restricciones vigentes.",
    "- Resultados importantes de herramientas (éxitos y fallos), sin secretos.",
    "No incluyas tokens, contraseñas ni claves.",
    "",
    "Resumen actual:",
    existing,
    "",
    "Nuevos mensajes a integrar:",
    serializedChunk,
    "",
    "Devuelve un resumen breve y estructurado en español (max 350 palabras).",
  ].join("\n");

  const response = await params.model.invoke([new HumanMessage(prompt)]);
  const summary =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  return {
    summary,
    stats: {
      ...params.stats,
      llmCompactions: params.stats.llmCompactions + 1,
      lastCompactedAt: new Date().toISOString(),
    },
  };
}
