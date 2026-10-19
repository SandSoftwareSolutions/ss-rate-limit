import type { IncomingMessage, ServerResponse } from "node:http";

export interface LimiterOptions {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
  /** Memory cap. Default 10000. */
  maxKeys?: number;
  /** Must return a finite number (milliseconds). A step back in time is ignored. */
  now?: () => number;
}

export interface CheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterMs: number;
  retryAfterSeconds: number;
}

export interface Limiter {
  /** `cost` is a finite number of at least 0 (0 only looks); anything else throws a RangeError. */
  check(key: string | number, cost?: number): CheckResult;
  reset(key: string | number): void;
  readonly size: number;
}

export function createLimiter(options: LimiterOptions): Limiter;

export function rateLimit(options: LimiterOptions & {
  key?: (req: IncomingMessage) => string;
  message?: string;
}): (req: IncomingMessage, res: ServerResponse, next?: () => void) => void;
