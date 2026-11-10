import type { BillingAccount, BillingProvider } from '@/services/api/billing';
import { normalizeApiBase } from '@/utils/connection';

export function grantExpiry(expiresAt: string | null, now: number) {
  const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
  if (!Number.isFinite(expiry)) return 'unknown';
  if (expiry <= now) return 'expired';
  return expiry - now <= 7 * 24 * 60 * 60 * 1000 ? 'expiring' : 'scheduled';
}
const shellQuote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
export function buildLoginCommand(
  provider: BillingProvider,
  apiBase: string,
  connectionId?: string
) {
  return `uv run console-login.py --provider ${provider} --url ${shellQuote(normalizeApiBase(apiBase))}${connectionId ? ` --connection-id ${shellQuote(connectionId)}` : ''}`;
}
/** Captures the client's monotonic revision, so switching away and back also invalidates work. */
export function createBillingRequestGuard(readRevision: () => number) {
  const revision = readRevision();
  return () => revision === readRevision();
}

/** Unknown observation time cannot establish freshness; server failure states take precedence. */
export function billingAccountStatus(
  account: BillingAccount,
  now: number
): BillingAccount['status'] {
  if (account.status !== 'ready') return account.status;
  const observed = account.observedAt ? Date.parse(account.observedAt) : NaN;
  if (!Number.isFinite(observed)) return 'unknown';
  return now - observed > 5 * 60 * 1000 ? 'stale' : 'ready';
}
