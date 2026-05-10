import {
  AIMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";

/**
 * OpenAI-compatible chat APIs require every assistant message with `tool_calls`
 * to be immediately followed by one ToolMessage per `tool_call_id`. Pending HITL
 * interrupts leave an AIMessage with tool_calls without ToolMessages; a new user
 * message then produces an invalid sequence. This repair inserts placeholder
 * ToolMessages for any missing ids so the next model call succeeds.
 */
export function repairAssistantToolCallSequences(
  messages: BaseMessage[]
): BaseMessage[] {
  const out: BaseMessage[] = [];
  let i = 0;
  while (i < messages.length) {
    const m = messages[i];
    if (m instanceof AIMessage && m.tool_calls?.length) {
      out.push(m);
      const callIds = m.tool_calls
        .map((tc) => tc.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      let j = i + 1;
      const toolMsgs: ToolMessage[] = [];
      while (j < messages.length && messages[j] instanceof ToolMessage) {
        toolMsgs.push(messages[j] as ToolMessage);
        j++;
      }
      const seen = new Set(
        toolMsgs.map((t) => t.tool_call_id).filter(Boolean) as string[]
      );
      for (const tm of toolMsgs) {
        out.push(tm);
      }
      for (const id of callIds) {
        if (!seen.has(id)) {
          out.push(
            new ToolMessage({
              tool_call_id: id,
              content: JSON.stringify({
                cancelled:
                  "Acción no completada antes del siguiente mensaje del usuario; ignora esta llamada.",
              }),
            })
          );
        }
      }
      i = j;
      continue;
    }
    out.push(m);
    i++;
  }
  return out;
}

/**
 * Takes the tail of `full` for the model context window and ensures we do not
 * start with orphan ToolMessages (can happen when the window cuts mid-turn).
 */
export function prepareMessagesForModel(
  full: BaseMessage[],
  summarizedUntil: number,
  recentWindow: number
): BaseMessage[] {
  let start = Math.max(summarizedUntil, full.length - recentWindow);
  while (start > 0 && full[start] instanceof ToolMessage) {
    start--;
  }
  return repairAssistantToolCallSequences(full.slice(start));
}
