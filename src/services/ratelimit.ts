/**
 * Rate Limiting & Budget Protection Service
 * Protects demo endpoints against API abuse, budget exhaustion, and burst requests.
 * Uses in-memory sliding window per IP and daily system counter.
 */

interface RateBucket {
  count: number;
  resetAt: number;
}

export class RateLimitService {
  private ipBuckets = new Map<string, RateBucket>();
  private dailyRequestCount = 0;
  private dailyResetTime = Date.now() + 24 * 60 * 60 * 1000;
  private maxRequestsPerMinute: number;
  private dailyBudgetCap: number;

  constructor(maxPerMin = 30, dailyCap = 200) {
    const envCap = typeof process !== 'undefined' ? Number(process.env.DAILY_REQUEST_CAP) : 200;
    this.maxRequestsPerMinute = maxPerMin;
    this.dailyBudgetCap = isNaN(envCap) || envCap <= 0 ? dailyCap : envCap;
  }

  checkLimit(ip: string = '127.0.0.1'): { allowed: boolean; reason?: string; remaining: number } {
    const now = Date.now();

    // Check daily budget cap
    if (now > this.dailyResetTime) {
      this.dailyRequestCount = 0;
      this.dailyResetTime = now + 24 * 60 * 60 * 1000;
    }

    if (this.dailyRequestCount >= this.dailyBudgetCap) {
      return {
        allowed: false,
        reason: `Daily prototype request limit (${this.dailyBudgetCap}) has been reached to protect demo budget. Try again tomorrow or use Demo Mode.`,
        remaining: 0
      };
    }

    // Check Per-IP sliding minute window
    let bucket = this.ipBuckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      bucket = {
        count: 0,
        resetAt: now + 60 * 1000
      };
      this.ipBuckets.set(ip, bucket);
    }

    if (bucket.count >= this.maxRequestsPerMinute) {
      return {
        allowed: false,
        reason: 'Rate limit exceeded: too many requests per minute from this IP. Please wait a few seconds.',
        remaining: 0
      };
    }

    bucket.count++;
    this.dailyRequestCount++;

    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequestsPerMinute - bucket.count)
    };
  }

  getStats() {
    return {
      dailyCount: this.dailyRequestCount,
      dailyCap: this.dailyBudgetCap,
      dailyRemaining: Math.max(0, this.dailyBudgetCap - this.dailyRequestCount),
      activeIps: this.ipBuckets.size
    };
  }
}

export const rateLimiter = new RateLimitService();
