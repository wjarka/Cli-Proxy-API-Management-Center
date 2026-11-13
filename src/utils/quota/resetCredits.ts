import type { CodexRateLimitResetCredit } from '@/types';
import { resolveResetMs } from './resetInstants';

export interface CodexResetCreditsSummary {
  availableCount: number | null;
  applicableAvailableCount: number | null;
  credits: CodexRateLimitResetCredit[];
  invalidPayload: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const normalizeStringValue = (value: unknown): string | null => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  return null;
};

const normalizeNumberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeCredit = (value: unknown): CodexRateLimitResetCredit | null => {
  const record = asRecord(value);
  if (!record) return null;
  if (normalizeStringValue(record.reset_type ?? record.resetType) !== 'codex_rate_limits') {
    return null;
  }
  if (normalizeStringValue(record.status) !== 'available') {
    return null;
  }

  const id = record.id;
  if (typeof id !== 'string' || !id.trim() || id.includes('$TOKEN$')) return null;

  return {
    id,
    status: 'available',
    grantedAt: normalizeStringValue(record.granted_at ?? record.grantedAt) ?? '',
    expiresAt: normalizeStringValue(record.expires_at ?? record.expiresAt) ?? '',
    title: typeof record.title === 'string' ? record.title.trim() : undefined,
    description: typeof record.description === 'string' ? record.description.trim() : undefined,
  };
};

export const normalizeCodexResetCreditsPayload = (payload: unknown): CodexResetCreditsSummary => {
  let parsedPayload = payload;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) {
      return {
        availableCount: null,
        applicableAvailableCount: null,
        credits: [],
        invalidPayload: true,
      };
    }
    try {
      parsedPayload = JSON.parse(trimmed);
    } catch {
      return {
        availableCount: null,
        applicableAvailableCount: null,
        credits: [],
        invalidPayload: true,
      };
    }
  }

  const record = asRecord(parsedPayload);
  if (!record) {
    return {
      availableCount: null,
      applicableAvailableCount: null,
      credits: [],
      invalidPayload: true,
    };
  }

  const hasExpectedShape =
    'credits' in record ||
    'available_count' in record ||
    'availableCount' in record ||
    'applicable_available_count' in record ||
    'applicableAvailableCount' in record;
  const credits = Array.isArray(record.credits)
    ? record.credits
        .map((item) => normalizeCredit(item))
        .filter((item): item is CodexRateLimitResetCredit => item !== null)
    : [];

  return {
    availableCount: normalizeNumberValue(record.available_count ?? record.availableCount),
    applicableAvailableCount: normalizeNumberValue(
      record.applicable_available_count ?? record.applicableAvailableCount
    ),
    credits,
    invalidPayload: !hasExpectedShape,
  };
};

export function listSelectableCodexCredits(
  credits: readonly CodexRateLimitResetCredit[],
  now: number
) {
  const seen = new Set<string>();
  return credits.filter((credit) => {
    if (!credit.id || credit.status !== 'available' || seen.has(credit.id)) return false;
    const expiresAt = resolveResetMs([credit.expiresAt]);
    if (credit.expiresAt && (expiresAt === null || expiresAt <= now)) return false;
    seen.add(credit.id);
    return true;
  });
}
