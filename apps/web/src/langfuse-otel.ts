import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

let sdk: NodeSDK | undefined;

/**
 * Registers OpenTelemetry with LangfuseSpanProcessor so @langfuse/langchain CallbackHandler
 * spans are exported (see Langfuse JS SDK quickstart). Safe to call multiple times.
 */
export function startLangfuseOtelIfConfigured(): void {
  if (sdk) return;
  const secret = process.env.LANGFUSE_SECRET_KEY?.trim();
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY?.trim();
  if (!secret || !publicKey) return;

  sdk = new NodeSDK({
    spanProcessors: [new LangfuseSpanProcessor()],
  });
  sdk.start();
}
