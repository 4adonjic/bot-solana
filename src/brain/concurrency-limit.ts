export interface ConcurrencyLimiterOptions {
  maxConcurrent?: number;
  maxQueued?: number;
}

/**
 * Limits the number of active tasks and bounds the waiting queue.
 * A rejected task still releases its slot so later work can continue.
 */
export function createConcurrencyLimiter<TInput, TResult>(
  task: (input: TInput) => Promise<TResult>,
  options: ConcurrencyLimiterOptions = {},
): (input: TInput) => Promise<TResult> {
  const maxConcurrent = options.maxConcurrent ?? 2;
  const maxQueued = options.maxQueued ?? 100;

  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error("maxConcurrent must be a positive integer");
  }
  if (!Number.isInteger(maxQueued) || maxQueued < 0) {
    throw new Error("maxQueued must be a non-negative integer");
  }

  type Job = {
    input: TInput;
    resolve: (value: TResult) => void;
    reject: (reason: unknown) => void;
  };

  const queue: Job[] = [];
  let active = 0;

  const drain = (): void => {
    while (active < maxConcurrent && queue.length > 0) {
      const job = queue.shift();
      if (!job) return;
      active += 1;

      Promise.resolve()
        .then(() => task(job.input))
        .then(job.resolve, job.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  };

  return (input: TInput): Promise<TResult> => {
    if (active >= maxConcurrent && queue.length >= maxQueued) {
      return Promise.reject(new Error("Security analysis queue is full"));
    }

    return new Promise<TResult>((resolve, reject) => {
      queue.push({ input, resolve, reject });
      drain();
    });
  };
}
