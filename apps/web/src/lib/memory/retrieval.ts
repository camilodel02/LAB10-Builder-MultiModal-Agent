import {
  createServerClient,
  searchRelevantMemories,
  incrementRetrievalCount,
} from "@agents/db";
import { generateEmbedding } from "./openrouter";

export async function retrieveRelevantMemories(
  userId: string,
  input: string
): Promise<string[]> {
  const topK = Number(process.env.MEMORY_RETRIEVAL_TOP_K ?? 8);
  const minScore = Number(process.env.MEMORY_RETRIEVAL_MIN_SCORE ?? 0.75);
  const db = createServerClient();

  const embedding = await generateEmbedding(input);
  const matches = await searchRelevantMemories(db, {
    userId,
    queryEmbedding: embedding,
    matchCount: topK,
    minScore,
  });

  for (const m of matches) {
    await incrementRetrievalCount(db, m.id);
  }

  return matches.map(
    (m) => `[${m.memory_type}] ${m.content} (score=${m.similarity.toFixed(3)})`
  );
}
