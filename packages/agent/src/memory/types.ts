import type { BaseMessage } from "@langchain/core/messages";

export interface CompactionStats {
  summarizedUntil: number;
  microCompactions: number;
  llmCompactions: number;
  lastCompactedAt?: string;
}

export interface CompactionResult {
  messages: BaseMessage[];
  compacted: boolean;
}
