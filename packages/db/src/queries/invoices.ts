import type { DbClient } from "../client";
import type { InvoiceIngestion, InvoiceIngestionStatus } from "@agents/types";

export async function upsertInvoiceIngestion(
  db: DbClient,
  params: {
    userId: string;
    sourceProvider: string;
    sourceFileId: string;
    fileName?: string;
    rawText?: string | null;
    extractedJson?: Record<string, unknown>;
    status?: InvoiceIngestionStatus;
    errorMessage?: string | null;
  }
): Promise<InvoiceIngestion> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("invoice_ingestions")
    .upsert(
      {
        user_id: params.userId,
        source_provider: params.sourceProvider,
        source_file_id: params.sourceFileId,
        file_name: params.fileName ?? "",
        raw_text: params.rawText ?? null,
        extracted_json: params.extractedJson ?? {},
        status: params.status ?? "pending_review",
        error_message: params.errorMessage ?? null,
        updated_at: now,
      },
      { onConflict: "user_id,source_provider,source_file_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data as InvoiceIngestion;
}

export async function updateInvoiceIngestionStatus(
  db: DbClient,
  params: {
    ingestionId: string;
    status: InvoiceIngestionStatus;
    errorMessage?: string | null;
    extractedJson?: Record<string, unknown>;
    rawText?: string | null;
  }
): Promise<InvoiceIngestion> {
  const { data, error } = await db
    .from("invoice_ingestions")
    .update({
      status: params.status,
      error_message: params.errorMessage ?? null,
      extracted_json: params.extractedJson,
      raw_text: params.rawText,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.ingestionId)
    .select()
    .single();
  if (error) throw error;
  return data as InvoiceIngestion;
}

export async function listInvoiceIngestionsByUser(
  db: DbClient,
  userId: string,
  limit = 50
): Promise<InvoiceIngestion[]> {
  const { data, error } = await db
    .from("invoice_ingestions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as InvoiceIngestion[];
}
