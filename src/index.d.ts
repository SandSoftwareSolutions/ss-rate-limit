import type { IncomingMessage, ServerResponse } from "node:http";

export interface LimiterOptions {
  /** Requests allowed per window. */
  limit: number;
  windowMs: number;
  /** Memory cap. Default 10000. */
  maxKeys?: number;
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
  check(key: string | number, cost?: number): CheckResult;
  reset(key: string | number): void;
  readonly size: number;
}

export function createLimiter(options: LimiterOptions): Limiter;

export function rateLimit(options: LimiterOptions & {
  key?: (req: IncomingMessage) => string;
  message?: string;
}): (req: IncomingMessage, res: ServerResponse, next?: () => void) => void;
