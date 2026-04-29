import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { CompactionResult } from "./types";

function normalizeContent(msg: BaseMessage): string {
  const content =
    typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
  return content.trim();
}

function truncateContent(content: string, maxCharsPerMessage: number): string {
  if (content.length <= maxCharsPerMessage) return content;
  return `${content.slice(0, maxCharsPerMessage)}\n...[truncated]`;
}

function cloneWithContent(msg: BaseMessage, content: string): BaseMessage {
  if (msg instanceof HumanMessage) return new HumanMessage(content);
  if (msg instanceof AIMessage) {
    return new AIMessage({
      content,
      tool_calls: msg.tool_calls,
      additional_kwargs: msg.additional_kwargs,
      response_metadata: msg.response_metadata,
    });
  }
  if (msg instanceof ToolMessage) {
    return new ToolMessage({
      content,
      tool_call_id: msg.tool_call_id,
      name: msg.name,
      additional_kwargs: msg.additional_kwargs,
      response_metadata: msg.response_metadata,
    });
  }
  return msg;
}

export function microCompactMessages(
  messages: BaseMessage[],
  maxCharsPerMessage = 2000
): CompactionResult {
  const compacted: BaseMessage[] = [];
  let changed = false;
  let prevSignature = "";

  for (const msg of messages) {
    const normalized = normalizeContent(msg);
    const signature = `${msg.getType()}::${normalized}`;

    // Drop exact consecutive duplicates.
    if (signature === prevSignature) {
      changed = true;
      continue;
    }

    const truncated = truncateContent(normalized, maxCharsPerMessage);
    if (truncated !== normalized) changed = true;

    compacted.push(cloneWithContent(msg, truncated));
    prevSignature = signature;
  }

  return { messages: compacted, compacted: changed };
}
