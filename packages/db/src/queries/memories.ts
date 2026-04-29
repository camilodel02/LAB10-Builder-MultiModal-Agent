import type { DbClient } from "../client";
import type {
  MemoryExtractionJob,
  MemoryExtractionJobStatus,
  MemoryType,
  UserMemory,
  UserMemoryMatch,
} from "@agents/types";

export async function enqueueMemoryExtractionJob(
  db: DbClient,
  userId: string,
  sessionId: string
): Promise<MemoryExtractionJob> {
  const { data, error } = await db
    .from("memory_extraction_jobs")
    .upsert(
      {
        user_id: userId,
        session_id: sessionId,
        status: "pending" as MemoryExtractionJobStatus,
        error_message: null,
      },
      { onConflict: "session_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as MemoryExtractionJob;
}

export async function claimPendingMemoryJobs(
  db: DbClient,
  limit = 10
): Promise<MemoryExtractionJob[]> {
  const { data: candidates, error } = await db
    .from("memory_extraction_jobs")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw error;
  if (!candidates || candidates.length === 0) return [];

  const ids = (candidates as MemoryExtractionJob[]).map((j) => j.id);
  const now = new Date().toISOString();
  await db
    .from("memory_extraction_jobs")
    .update({
      status: "processing" as MemoryExtractionJobStatus,
      started_at: now,
    })
    .in("id", ids)
    .eq("status", "pending");

  return (candidates as MemoryExtractionJob[]).map((job) => ({
    ...job,
    status: "processing",
    started_at: now,
    attempts: job.attempts + 1,
  }));
}

export async function completeMemoryExtractionJob(
  db: DbClient,
  jobId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from("memory_extraction_jobs")
    .update({
      status: "completed" as MemoryExtractionJobStatus,
      finished_at: now,
      error_message: null,
    })
    .eq("id", jobId);
  if (error) throw error;
}

export async function failMemoryExtractionJob(
  db: DbClient,
  jobId: string,
  errorMessage: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db
    .from("memory_extraction_jobs")
    .update({
      status: "failed" as MemoryExtractionJobStatus,
      finished_at: now,
      error_message: errorMessage,
    })
    .eq("id", jobId);
  if (error) throw error;
}

export async function upsertUserMemory(
  db: DbClient,
  params: {
    userId: string;
    sessionId?: string | null;
    memoryType: MemoryType;
    content: string;
    embedding: number[];
  }
): Promise<UserMemory> {
  const { data, error } = await db
    .from("user_memories")
    .insert({
      user_id: params.userId,
      session_id: params.sessionId ?? null,
      memory_type: params.memoryType,
      content: params.content,
      embedding: params.embedding,
      archived: false,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as UserMemory;
}

export async function searchRelevantMemories(
  db: DbClient,
  params: {
    userId: string;
    queryEmbedding: number[];
    matchCount: number;
    minScore: number;
  }
): Promise<UserMemoryMatch[]> {
  const { data, error } = await db.rpc("match_user_memories", {
    p_user_id: params.userId,
    p_query_embedding: params.queryEmbedding,
    p_match_count: params.matchCount,
    p_min_score: params.minScore,
  });
  if (error) throw error;
  return (data ?? []) as UserMemoryMatch[];
}

export async function incrementRetrievalCount(
  db: DbClient,
  memoryId: string
): Promise<void> {
  const { data: row, error: getError } = await db
    .from("user_memories")
    .select("retrieval_count")
    .eq("id", memoryId)
    .single();
  if (getError) throw getError;

  const currentCount = (row?.retrieval_count as number | undefined) ?? 0;
  const { error } = await db
    .from("user_memories")
    .update({
      retrieval_count: currentCount + 1,
      last_retrieved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", memoryId);
  if (error) throw error;
}

export async function archiveLowScoreMemories(
  db: DbClient,
  userId: string,
  retrievalCountBelow = 1
): Promise<number> {
  const { data, error } = await db
    .from("user_memories")
    .update({ archived: true, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("archived", false)
    .lt("retrieval_count", retrievalCountBelow)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}
