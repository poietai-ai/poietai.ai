const WINDOW_MS = 60_000; // 1 minute
const MAX_PER_WINDOW = 10;

// Map of conversationId -> timestamps of agent messages
const messageTimestamps: Map<string, number[]> = new Map();

/**
 * Check if an agent message is within rate limits.
 * Returns true if allowed, false if rate limited.
 */
export function checkAgentMessageRate(conversationId: string, _agentId: string): boolean {
  const now = Date.now();
  const key = conversationId;
  const timestamps = messageTimestamps.get(key) ?? [];

  // Remove timestamps outside the window
  const recent = timestamps.filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_PER_WINDOW) {
    messageTimestamps.set(key, recent);
    return false;
  }

  recent.push(now);
  messageTimestamps.set(key, recent);
  return true;
}

/**
 * Check if a conversation has had too many agent-only messages without user input.
 * Returns true if the conversation should be paused.
 */
export function checkConversationDepth(messages: { from: string }[]): boolean {
  const DEPTH_LIMIT = 20;
  let agentOnly = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].from === 'user') break;
    if (messages[i].from !== 'system') agentOnly++;
  }
  return agentOnly >= DEPTH_LIMIT;
}

export function resetRateLimits(): void {
  messageTimestamps.clear();
}
