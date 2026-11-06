import { RESERVE_DAYS, type ReserveDay } from './quotaReserves';

export interface QuotaUsagePolicy {
  policy: string;
  timezone: string;
  schedule: { days: ReserveDay[]; start: string; end: string }[];
  configuredPercent: number;
  protectedPercent: number | null;
  remainingPercent: number | null;
  active: boolean | null;
  activeUntil: string | null;
  status: 'allowed' | 'reserved' | 'unknown' | 'unavailable' | 'inactive';
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const percent = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const clock = (value: unknown): value is string =>
  typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const timestamp = (value: unknown): string | null =>
  typeof value === 'string' &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).getUTCFullYear() >= 2000
    ? value
    : null;

/** The backend owns schedule activation; quota freshness never changes its configured floor. */
export function normalizeQuotaUsagePolicies(
  routing: unknown,
  overview: unknown
): Record<string, QuotaUsagePolicy> {
  if (!record(routing)) throw Error('Invalid usage policy configuration');
  const bindings = routing['account-policies'] ?? [];
  const policies = routing['usage-policies'] ?? {};
  if (!Array.isArray(bindings) || !record(policies))
    throw Error('Invalid usage policy configuration');
  const accounts = record(overview) && Array.isArray(overview.accounts) ? overview.accounts : [];
  const statuses = new Map(
    accounts.filter(record).map((account) => [account.id, account.usage_policy])
  );
  const result: Record<string, QuotaUsagePolicy> = Object.create(null);
  for (const binding of bindings) {
    if (!record(binding) || typeof binding.account !== 'string')
      throw Error('Invalid usage policy binding');
    if (binding['usage-policy'] == null && typeof binding['reserve-policy'] === 'string') continue;
    const name = binding['usage-policy'];
    if (typeof name !== 'string') throw Error('Invalid usage policy binding');
    const policy = policies[name];
    if (!record(policy)) throw Error('Invalid usage policy');
    let configuredPercent = policy['protected-budget-percent'];
    const legacyUsed = policy['five-hour-used-percent'];
    if (legacyUsed != null) {
      if (configuredPercent != null || !percent(legacyUsed)) throw Error('Invalid usage policy');
      configuredPercent = 100 - legacyUsed;
    }
    if (
      typeof policy.timezone !== 'string' ||
      !percent(configuredPercent) ||
      !Array.isArray(policy.schedule) ||
      policy.schedule.length === 0
    )
      throw Error('Invalid usage policy');
    new Intl.DateTimeFormat('en', { timeZone: policy.timezone });
    const schedule = policy.schedule.map((entry) => {
      if (
        !record(entry) ||
        !Array.isArray(entry.days) ||
        entry.days.length === 0 ||
        !entry.days.every((day): day is ReserveDay => RESERVE_DAYS.includes(day)) ||
        !clock(entry.start) ||
        !clock(entry.end) ||
        entry.start >= entry.end
      )
        throw Error('Invalid usage policy schedule');
      return { days: entry.days, start: entry.start, end: entry.end };
    });
    const raw = statuses.get(binding.account);
    const status = record(raw) && raw.policy === name ? raw : {};
    const active = typeof status.active === 'boolean' ? status.active : null;
    const protectedPercent =
      active === false
        ? 0
        : active === true && percent(status.protected_percent)
          ? status.protected_percent
          : null;
    const remainingPercent = percent(status.remaining_percent) ? status.remaining_percent : null;
    let state: QuotaUsagePolicy['status'] = 'unavailable';
    if (active === false && status.blocked === false) state = 'inactive';
    else if (active === true && status.blocked === true && status.reason === 'quota_unknown')
      state = 'unknown';
    else if (active === true && protectedPercent !== null) {
      if (status.blocked === true && status.reason === 'five_hour_limit') state = 'reserved';
      else if (status.blocked === false && remainingPercent !== null) state = 'allowed';
    }
    result[binding.account] = {
      policy: name,
      timezone: policy.timezone,
      schedule,
      configuredPercent,
      protectedPercent,
      remainingPercent,
      active,
      activeUntil: active === true ? timestamp(status.active_until) : null,
      status: state,
    };
  }
  return result;
}
