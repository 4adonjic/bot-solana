export interface JupiterQuote {
  outAmountRaw: string;
  priceImpactPct?: string;
}

export interface JupiterQuoteProviderOptions {
  apiKey?: string;
  /** Keyless Jupiter access is limited to 0.5 requests/second; keyed free access to 1/second. */
  minimumRequestIntervalMs?: number;
  endpoint?: string;
}

/**
 * Read-only Jupiter Swap API v2 quote client.
 * It never requests a transaction (no taker parameter) and never signs or submits anything.
 */
export class JupiterQuoteProvider {
  private readonly apiKey: string | undefined;
  private readonly minimumRequestIntervalMs: number;
  private readonly endpoint: string;
  private nextRequestAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: JupiterQuoteProviderOptions = {}) {
    this.apiKey = options.apiKey;
    this.minimumRequestIntervalMs = options.minimumRequestIntervalMs ??
      (this.apiKey ? 1_000 : 2_000);
    this.endpoint = options.endpoint ?? "https://api.jup.ag/swap/v2/order";
    if (!Number.isSafeInteger(this.minimumRequestIntervalMs) || this.minimumRequestIntervalMs < 1) {
      throw new Error("minimumRequestIntervalMs must be a positive safe integer");
    }
  }

  async getQuote(inputMint: string, outputMint: string, amountRaw: string): Promise<JupiterQuote | null> {
    if (!inputMint || !outputMint || inputMint === outputMint ||
        !/^\d+$/.test(amountRaw) || BigInt(amountRaw) <= 0n) return null;

    const run = this.queue.then(async () => {
      const now = Date.now();
      const scheduledAt = Math.max(now, this.nextRequestAt);
      this.nextRequestAt = scheduledAt + this.minimumRequestIntervalMs;
      if (scheduledAt > now) {
        await new Promise<void>((resolve) => setTimeout(resolve, scheduledAt - now));
      }

      const url = new URL(this.endpoint);
      url.search = new URLSearchParams({
        inputMint,
        outputMint,
        amount: amountRaw,
      }).toString();

      const headers: Record<string, string> = { accept: "application/json" };
      if (this.apiKey) headers["x-api-key"] = this.apiKey;

      try {
        const response = await fetch(url, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return null;
        const payload: unknown = await response.json();
        if (typeof payload !== "object" || payload === null) return null;
        const item = payload as { outAmount?: unknown; priceImpactPct?: unknown };
        if (typeof item.outAmount !== "string" ||
            !/^\d+$/.test(item.outAmount) || BigInt(item.outAmount) <= 0n) return null;
        return {
          outAmountRaw: item.outAmount,
          ...(typeof item.priceImpactPct === "string" ? { priceImpactPct: item.priceImpactPct } : {}),
        };
      } catch {
        return null;
      }
    });
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}
