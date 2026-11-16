/**
 * A continuously refilling token bucket. It is deliberately tiny: one of these
 * lives on every phone socket, so it must stay allocation-free per call.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number,
  ) {
    this.tokens = burst;
    this.last = Date.now();
  }

  /** Consume one token; false means the caller is over its budget right now. */
  take(): boolean {
    const now = Date.now();
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSecond);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
