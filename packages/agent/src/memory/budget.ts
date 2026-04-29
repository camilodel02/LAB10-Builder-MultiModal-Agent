import type { BaseMessage } from "@langchain/core/messages";

export function estimateChars(messages: BaseMessage[]): number {
  return messages.reduce((acc, msg) => {
    const content =
      typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    return acc + content.length;
  }, 0);
}

export function shouldRunLlmCompaction(
  messages: BaseMessage[],
  hardThresholdChars: number
): boolean {
  return estimateChars(messages) >= hardThresholdChars;
}
