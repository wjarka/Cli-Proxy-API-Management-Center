import { apiClient } from './client';

export const RESERVE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type ReserveDay = (typeof RESERVE_DAYS)[number];

export interface QuotaReserve {
  policy: string;
  timezone: string;
  schedule: { days: ReserveDay[]; percent: number; releaseAt: string }[];
  protectedPercent: number | null;
  remainingPercent: number | null;
  nextReleaseAt: string | null;
  status: 'allowed' | 'reserved' | 'unknown' | 'unavailable';
}

export function quotaReserveForFile(
  reserves: Record<string, QuotaReserve>,
  file: { id?: unknown; name: string }
): QuotaReserve | undefined {
  const id = typeof file.id === 'string' && file.id.length > 0 ? file.id : file.name;
  return reserves[id];
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const percent = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const timestamp = (value: unknown): string | null =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).getUTCFullYear() >= 2000
    ? value
    : null;

/** Join stable credential IDs; provider email/labels are never account identifiers. */
export function normalizeQuotaReserves(
  routing: unknown,
  overview: unknown
): Record<string, QuotaReserve> {
  if (!record(routing)) throw Error('Invalid reserve configuration');
  const bindings = routing['account-policies'] ?? [];
  const policies = routing['reserve-policies'] ?? {};
  if (!Array.isArray(bindings) || !record(policies)) throw Error('Invalid reserve configuration');
  const accounts = record(overview) && Array.isArray(overview.accounts) ? overview.accounts : [];
  const statuses = new Map(accounts.filter(record).map((account) => [account.id, account.reserve]));
  const result: Record<string, QuotaReserve> = Object.create(null);
  for (const binding of bindings) {
    if (
      !record(binding) ||
      typeof binding.account !== 'string' ||
      typeof binding['reserve-policy'] !== 'string'
    )
      throw Error('Invalid reserve binding');
    const name = binding['reserve-policy'];
    const policy = policies[name];
    if (!record(policy) || typeof policy.timezone !== 'string' || !Array.isArray(policy.schedule))
      throw Error('Invalid reserve policy');
    // Validate before passing a backend-provided zone to date formatting in the UI.
    new Intl.DateTimeFormat('en', { timeZone: policy.timezone });
    const schedule = policy.schedule.map((entry) => {
      if (
        !record(entry) ||
        !Array.isArray(entry.days) ||
        entry.days.length === 0 ||
        !entry.days.every((day): day is ReserveDay => RESERVE_DAYS.includes(day)) ||
        !percent(entry['protected-budget-percent']) ||
        typeof entry['release-at'] !== 'string' ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry['release-at'])
      )
        throw Error('Invalid reserve schedule');
      return {
        days: entry.days,
        percent: entry['protected-budget-percent'],
        releaseAt: entry['release-at'],
      };
    });
    const raw = statuses.get(binding.account);
    const status = record(raw) && raw.policy === name ? raw : {};
    const resetUnknown = status.reason === 'quota_unknown' && !timestamp(status.reset_at);
    const protectedPercent =
      !resetUnknown && percent(status.protected_percent) ? status.protected_percent : null;
    const remainingPercent = percent(status.remaining_percent) ? status.remaining_percent : null;
    let state: QuotaReserve['status'] = 'unavailable';
    if (status.blocked === true && status.reason === 'quota_unknown') state = 'unknown';
    else if (protectedPercent !== null && typeof status.blocked === 'boolean') {
      if (status.blocked && status.reason === 'quota_reserved') state = 'reserved';
      else if (!status.blocked && remainingPercent !== null) state = 'allowed';
    }
    result[binding.account] = {
      policy: name,
      timezone: policy.timezone,
      schedule,
      protectedPercent,
      remainingPercent,
      nextReleaseAt: timestamp(status.next_release_at),
      status: state,
    };
  }
  return result;
}

export const quotaReservesApi = {
  async get(signal?: AbortSignal): Promise<Record<string, QuotaReserve>> {
    const revision = apiClient.getConnectionRevision();
    const routing = await apiClient.get('/config/routing', { signal });
    if (revision !== apiClient.getConnectionRevision()) throw Error('Connection changed');
    const configured = normalizeQuotaReserves(routing, null);
    if (Object.keys(configured).length === 0) return configured;
    let overview: unknown;
    try {
      overview = await apiClient.get('/credentials/quota-overview', { signal });
    } catch {
      // A failed live read must not hide an account's configured protection.
      overview = null;
    }
    if (revision !== apiClient.getConnectionRevision()) throw Error('Connection changed');
    return normalizeQuotaReserves(routing, overview);
  },
};
