import { createHash } from "node:crypto";

const DEFAULT_NICKNAME = "Doer";
const MAX_NICKNAME_LENGTH = 24;
const MAX_BODY_LENGTH = 1200;
const MIN_BODY_LENGTH = 1;

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 8;
const MIN_SUBMIT_INTERVAL_MS = 5000;

const rateLimitByIp = new Map<string, number[]>();
const lastSubmitByClient = new Map<string, number>();

export function sanitizeClientId(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.trim().slice(0, 128);
}

export function createClientHash(clientId: string): string {
  return createHash("sha256").update(clientId).digest("hex");
}

export function sanitizeNickname(input: unknown): string {
  if (typeof input !== "string") {
    return DEFAULT_NICKNAME;
  }

  const trimmed = input.trim().slice(0, MAX_NICKNAME_LENGTH);
  return trimmed || DEFAULT_NICKNAME;
}

export function sanitizeCommentBody(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }

  const normalized = input.replace(/\r\n/g, "\n").trim().slice(0, MAX_BODY_LENGTH);
  return normalized;
}

export function validateCommentBody(body: string): { ok: true } | { ok: false; message: string } {
  if (body.length < MIN_BODY_LENGTH) {
    return { ok: false, message: "评论内容不能为空。" };
  }

  if (body.length > MAX_BODY_LENGTH) {
    return { ok: false, message: `评论内容不能超过 ${MAX_BODY_LENGTH} 字。` };
  }

  return { ok: true };
}

function getSensitiveWordsFromEnv(): string[] {
  const raw = process.env.COMMENT_SENSITIVE_WORDS?.trim();
  if (!raw) {
    return [];
  }

  return raw
    .split(/[\n,]/g)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function containsSensitiveWord(body: string): boolean {
  const words = getSensitiveWordsFromEnv();
  if (words.length === 0) {
    return false;
  }

  const normalized = body.toLowerCase();
  return words.some((word) => normalized.includes(word));
}

function compactTimestamps(timestamps: number[], now: number): number[] {
  return timestamps.filter((value) => now - value <= RATE_LIMIT_WINDOW_MS);
}

export function checkCommentRateLimit(input: { ip: string; clientHash: string }): {
  ok: true;
} | {
  ok: false;
  message: string;
} {
  const now = Date.now();
  const ip = input.ip || "unknown";

  const rawTimestamps = rateLimitByIp.get(ip) ?? [];
  const timestamps = compactTimestamps(rawTimestamps, now);
  if (timestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitByIp.set(ip, timestamps);
    return { ok: false, message: "发布过于频繁，请稍后再试。" };
  }

  const lastSubmitAt = lastSubmitByClient.get(input.clientHash);
  if (typeof lastSubmitAt === "number" && now - lastSubmitAt < MIN_SUBMIT_INTERVAL_MS) {
    return { ok: false, message: "发布过于频繁，请稍后再试。" };
  }

  timestamps.push(now);
  rateLimitByIp.set(ip, timestamps);
  lastSubmitByClient.set(input.clientHash, now);

  return { ok: true };
}
