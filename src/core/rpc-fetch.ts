/**
 * Shared HTTP RPC pacing for the Helius Free tier.
 *
 * Starts at most one HTTP request every 125 ms (8 requests/second), leaving
 * headroom below the provider's 10 requests/second limit. All Connection
 * instances import this same function, so they share one process-wide schedule.
 *
 * WebSocket messages are not affected by this HTTP fetch limiter.
 */
const MIN_REQUEST_INTERVAL_MS = 125;
let nextRequestAt = 0;

export const rateLimitedRpcFetch: typeof fetch = async (input, init) => {
  const now = Date.now();
  const scheduledAt = Math.max(now, nextRequestAt);
  nextRequestAt = scheduledAt + MIN_REQUEST_INTERVAL_MS;

  const delayMs = scheduledAt - now;
  if (delayMs > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  return fetch(input, init);
};
