import { apiClient } from './client';

export type BillingProvider = 'claude' | 'openai';
export interface BillingConnection {
  id: string;
  provider: BillingProvider;
  label: string;
  status: 'ready' | 'reconnect_required' | 'error';
  accountIds: string[];
  updatedAt: string | null;
  error: string | null;
}
export interface BillingGrant {
  id: string;
  name: string;
  kind: string;
  amount: number | null;
  remaining: number | null;
  expiresAt: string | null;
}
export interface BillingAccount {
  id: string;
  provider: BillingProvider;
  organizationId: string;
  name: string;
  connectionId: string;
  balance: number | null;
  currency: string;
  grants: BillingGrant[];
  observedAt: string | null;
  status: 'ready' | 'unknown' | 'stale' | 'reconnect_required';
  error: string | null;
}
export interface BillingBinding {
  credentialId: string;
  accountId: string;
  verified: boolean;
}
export interface BillingCredential {
  id: string;
  label: string;
  provider: BillingProvider;
  organizationId: string;
  verificationStatus: string;
}
export interface BillingSnapshot {
  connections: BillingConnection[];
  accounts: BillingAccount[];
  bindings: BillingBinding[];
  credentials: BillingCredential[];
}
const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const amount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const date = (value: unknown): string | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.map(record) : [];
const provider = (value: unknown): value is BillingProvider =>
  value === 'claude' || value === 'openai';

const errorKeys: Record<string, string> = {
  organization_mismatch: 'error_organization_mismatch',
  partial_billing_access: 'error_partial_billing_access',
  unsupported_endpoint: 'error_unsupported_endpoint',
  session_expired: 'error_session_expired',
  permission_denied: 'error_permission_denied',
  storage_conflict: 'error_storage_conflict',
  storage_busy: 'error_storage_busy',
  storage_error: 'error_storage_unavailable',
  storage_corrupt: 'error_storage_unavailable',
  billing_storage_unavailable: 'error_storage_unavailable',
  invalid_provider: 'error_invalid_request',
  invalid_request: 'error_invalid_request',
  invalid_connection: 'error_invalid_request',
  invalid_credential: 'error_invalid_request',
  invalid_billing_account: 'error_invalid_request',
  invalid_binding: 'error_invalid_request',
  invalid_label: 'error_invalid_request',
  invalid_session: 'error_invalid_session',
  not_found: 'error_not_found',
  superseded: 'error_storage_conflict',
  credential_changed: 'error_storage_conflict',
  no_organizations: 'error_no_organizations',
  invalid_response: 'error_provider_response',
  unsupported_currency: 'error_provider_response',
  redirect_rejected: 'error_provider_response',
  provider_unavailable: 'error_provider_response',
  rate_limited: 'error_rate_limited',
  organization_not_connected: 'error_organization_not_connected',
  organization_verification_failed: 'error_organization_verification_failed',
  console_operation_failed: 'action_failed',
};
const safeErrorCode = (value: unknown): string | null =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(errorKeys, value)
    ? value
    : null;

export function billingErrorKey(error: unknown, fallback = 'billing.action_failed'): string {
  const candidate = record(error);
  const code =
    safeErrorCode(error) ??
    safeErrorCode(candidate.apiCode) ??
    safeErrorCode(record(candidate.details).error);
  return code ? `billing.${errorKeys[code]}` : fallback;
}

/** Allowlist the wire contract so Console sessions and provider error bodies never reach views. */
export function normalizeBillingSnapshot(value: unknown): BillingSnapshot {
  const raw = record(value);
  return {
    connections: list(raw.connections)
      .filter((c) => provider(c.provider))
      .map((c) => ({
        id: text(c.id),
        provider: c.provider as BillingProvider,
        label: text(c.label),
        status: c.status === 'ready' || c.status === 'reconnect_required' ? c.status : 'error',
        accountIds: Array.isArray(c.account_ids)
          ? c.account_ids.filter((id): id is string => typeof id === 'string')
          : [],
        updatedAt: date(c.updated_at),
        error: safeErrorCode(c.error),
      })),
    accounts: list(raw.accounts)
      .filter((a) => provider(a.provider))
      .map((a) => ({
        id: text(a.id),
        provider: a.provider as BillingProvider,
        organizationId: text(a.organization_id),
        name: text(a.name),
        connectionId: text(a.connection_id),
        balance: amount(a.balance),
        currency: text(a.currency) || 'USD',
        observedAt: date(a.observed_at),
        error: safeErrorCode(a.error),
        status:
          a.status === 'ready' || a.status === 'stale' || a.status === 'reconnect_required'
            ? a.status
            : 'unknown',
        grants: list(a.grants).map((g) => ({
          id: text(g.id),
          name: text(g.name),
          kind: text(g.kind),
          amount: amount(g.amount),
          remaining: amount(g.remaining),
          expiresAt: date(g.expires_at),
        })),
      })),
    bindings: list(raw.bindings).map((b) => ({
      credentialId: text(b.credential_id),
      accountId: text(b.account_id),
      verified: b.verified === true,
    })),
    credentials: list(raw.credentials)
      .filter((c) => provider(c.provider))
      .map((c) => ({
        id: text(c.id),
        label: text(c.label),
        provider: c.provider as BillingProvider,
        organizationId: text(c.organization_id),
        verificationStatus: text(c.verification_status),
      })),
  };
}
export const billingApi = {
  list: async (): Promise<BillingSnapshot> =>
    normalizeBillingSnapshot(await apiClient.get('/billing')),
  connect: (provider: BillingProvider, label: string, session: string) =>
    apiClient.post('/billing/connections', { provider, label, session }),
  reconnect: (id: string, session: string) =>
    apiClient.patch(`/billing/connections/${encodeURIComponent(id)}`, { session }),
  refresh: (id: string) => apiClient.post(`/billing/connections/${encodeURIComponent(id)}/refresh`),
  disconnect: (id: string) => apiClient.delete(`/billing/connections/${encodeURIComponent(id)}`),
  bind: (credentialId: string, accountId: string) =>
    apiClient.put('/billing/bindings', { credential_id: credentialId, account_id: accountId }),
  unbind: (credentialId: string) =>
    apiClient.delete('/billing/bindings', { params: { credential_id: credentialId } }),
  verify: (credentialId: string) =>
    apiClient.post('/billing/credentials/verify', { credential_id: credentialId }),
  loginHelper: async (): Promise<string> =>
    (await apiClient.getRaw('/billing/login-helper', { responseType: 'text' })).data,
};
