import type { BillingAccount, BillingProvider } from '@/services/api/billing';
import { computeApiUrl, normalizeApiBase } from '@/utils/connection';

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

export function browserViewerUrl(apiBase: string, id: string): string {
  const url = new URL(
    `${computeApiUrl(apiBase)}/billing/browser/sessions/${encodeURIComponent(id)}/view`
  );
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('invalid_request');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** Owns temporary sessions, including responses arriving after UI teardown or connection changes. */
export function createBrowserLoginFlow(
  api: Pick<
    ReturnType<typeof import('@/services/api/billing').createBillingBrowserApi>,
    'create' | 'remove' | 'finish'
  >,
  current: () => boolean,
  changed: (session: import('@/services/api/billing').BillingBrowserSession | null) => void
) {
  let generation = 0;
  let disposed = false;
  let session: import('@/services/api/billing').BillingBrowserSession | null = null;
  const remove = (id: string) => {
    void api.remove(id).catch(() => {});
  };
  const cancel = () => {
    generation++;
    if (session) remove(session.id);
    session = null;
    if (!disposed && current()) changed(null);
  };
  return {
    get session() {
      return session;
    },
    cancel,
    activate: () => {
      disposed = false;
    },
    dispose: () => {
      disposed = true;
      cancel();
    },
    start: async (request: import('@/services/api/billing').BillingBrowserRequest) => {
      cancel();
      const sequence = generation;
      const created = await api.create(request);
      if (disposed || !current() || sequence !== generation) {
        remove(created.id);
        return;
      }
      session = created;
      changed(created);
    },
    finish: async () => {
      if (!session || disposed || !current()) return null;
      const sequence = generation;
      const id = await api.finish(session.id);
      if (disposed || !current() || sequence !== generation) return null;
      session = null;
      generation++;
      changed(null);
      return id;
    },
  };
}
