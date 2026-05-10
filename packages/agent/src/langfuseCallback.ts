import { CallbackHandler } from "@langfuse/langchain";
import { getLangfuseTracerProvider } from "@langfuse/tracing";

function keysConfigured(): boolean {
  const secret = process.env.LANGFUSE_SECRET_KEY?.trim();
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  return Boolean(secret && publicKey);
}

export interface LangfuseTraceOptions {
  /** Extra tags for dashboards (e.g. feature:web-chat). */
  tags?: string[];
  /** Trace-level metadata (keep non-sensitive; avoid secrets). */
  traceMetadata?: Record<string, unknown>;
  /** Maps to Langfuse release/version on the trace (e.g. git SHA or `LANGFUSE_RELEASE`). */
  release?: string;
}

/** Langfuse LangChain callback when env keys are set; otherwise undefined (no-op). */
export function createLangfuseCallbackHandler(opts: {
  sessionId: string;
  userId: string;
  tags?: string[];
  traceMetadata?: Record<string, unknown>;
  release?: string;
}): CallbackHandler | undefined {
  if (!keysConfigured()) return undefined;
  const tags = ["langgraph-agent", ...(opts.tags ?? [])];
  return new CallbackHandler({
    sessionId: opts.sessionId,
    userId: opts.userId,
    tags,
    traceMetadata: opts.traceMetadata,
    version: opts.release,
  });
}

/**
 * Ensures batched OTEL spans are exported before the HTTP response / process exit.
 * Recommended for Next.js route handlers and short-lived workers (Langfuse SDK docs).
 */
export async function flushLangfuseTracingIfEnabled(): Promise<void> {
  if (!keysConfigured()) return;
  try {
    const provider = getLangfuseTracerProvider() as {
      forceFlush?: () => Promise<void>;
    };
    await provider.forceFlush?.();
  } catch {
    // Provider may be unavailable if tracing never initialized this process.
  }
}
