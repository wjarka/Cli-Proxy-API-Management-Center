import { afterEach, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { I18nextProvider } from 'react-i18next';
import { apiClient } from '@/services/api/client';
import { billingApi, normalizeBillingSnapshot } from '@/services/api/billing';
import {
  buildLoginCommand,
  grantExpiry,
  createBillingRequestGuard,
} from '@/features/billing/logic';
import { BillingAccounts } from '@/features/billing/BillingAccounts';

const billingI18n = i18n.cloneInstance({ lng: 'en' });
const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => spies.splice(0).forEach((spy) => spy.mockRestore()));

const fixture = {
  connections: [
    {
      id: 'login',
      provider: 'claude',
      label: 'Work',
      status: 'ready',
      account_ids: ['org'],
      session: 'secret-fixture',
    },
  ],
  accounts: [
    {
      id: 'org',
      provider: 'claude',
      organization_id: 'organization',
      name: 'Work org',
      connection_id: 'login',
      balance: 0,
      currency: 'USD',
      status: 'stale',
      grants: [
        {
          id: 'grant',
          name: 'Promotion',
          amount: 10,
          remaining: null,
          expires_at: '2026-01-01T00:00:00Z',
        },
      ],
      session: 'secret-fixture',
    },
    {
      id: 'unknown',
      provider: 'openai',
      organization_id: 'other',
      name: 'Other org',
      balance: null,
      status: 'unknown',
      grants: [],
    },
  ],
  bindings: [{ credential_id: 'key-id', account_id: 'org', verified: false }],
  credentials: [{ id: 'key-id', label: 'API key', provider: 'claude', api_key: 'secret-fixture' }],
};

test('normalizes financial unknowns without converting absent or malformed amounts to zero', () => {
  const data = normalizeBillingSnapshot(fixture);
  expect(data.accounts[0].balance).toBe(0);
  expect(data.accounts[1].balance).toBeNull();
  expect(data.accounts[0].grants[0].remaining).toBeNull();
  expect(data.accounts[0].status).toBe('stale');
  expect(JSON.stringify(data)).not.toContain('secret-fixture');
  const malformed = normalizeBillingSnapshot({
    accounts: [
      {
        ...fixture.accounts[0],
        balance: '0',
        grants: [{ amount: Infinity, remaining: '3', expires_at: 'invalid' }],
      },
    ],
  });
  expect(malformed.accounts[0].balance).toBeNull();
  expect(malformed.accounts[0].grants[0].amount).toBeNull();
  expect(malformed.accounts[0].grants[0].expiresAt).toBeNull();
  expect(normalizeBillingSnapshot(null)).toEqual({
    connections: [],
    accounts: [],
    bindings: [],
    credentials: [],
  });
});

test('renders organizations, stale zero, unknown balances, grant expiry and unverified mappings without secrets', () => {
  const data = normalizeBillingSnapshot(fixture);
  const markup = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: billingI18n },
      createElement(BillingAccounts, {
        accounts: data.accounts,
        now: Date.parse('2026-02-01T00:00:00Z'),
      })
    )
  );
  expect(markup).toContain('Work org');
  expect(markup).toContain('$0.00');
  expect(markup).toContain('Stale');
  expect(markup).toContain('Unknown');
  expect(markup).toContain('Expired');
  expect(markup).toContain('Promotion');
  expect(markup).not.toContain('secret-fixture');
});

test('grant expiry preserves missing dates and distinguishes expired from expiring', () => {
  const now = Date.parse('2026-02-01T00:00:00Z');
  expect(grantExpiry(null, now)).toBe('unknown');
  expect(grantExpiry('not-a-date', now)).toBe('unknown');
  expect(grantExpiry('2026-01-01T00:00:00Z', now)).toBe('expired');
  expect(grantExpiry('2026-02-02T00:00:00Z', now)).toBe('expiring');
  expect(grantExpiry('2026-12-01T00:00:00Z', now)).toBe('scheduled');
});

test('helper command shell-quotes only connection metadata and never contains a management-key option', () => {
  expect(buildLoginCommand('openai', 'https://proxy.invalid/v8/management', "id'quoted")).toBe(
    "uv run console-login.py --provider openai --url 'https://proxy.invalid' --connection-id 'id'\"'\"'quoted'"
  );
  expect(buildLoginCommand('claude', 'https://proxy.invalid')).not.toContain('--key');
});

test('request guard rejects responses after connection switching, including ABA and logout', () => {
  let revision = 1;
  const current = createBillingRequestGuard(() => revision);
  expect(current()).toBe(true);
  revision = 3;
  expect(current()).toBe(false);
});

test('billing operations use the authenticated v8 domain and exact backend bodies', async () => {
  const get = spyOn(apiClient, 'get').mockResolvedValue(fixture);
  spies.push(get);
  const post = spyOn(apiClient, 'post').mockResolvedValue({});
  spies.push(post);
  const patch = spyOn(apiClient, 'patch').mockResolvedValue({});
  spies.push(patch);
  const put = spyOn(apiClient, 'put').mockResolvedValue({});
  spies.push(put);
  const del = spyOn(apiClient, 'delete').mockResolvedValue({});
  spies.push(del);
  const raw = spyOn(apiClient, 'getRaw').mockResolvedValue({ data: '# helper' } as never);
  spies.push(raw);
  await billingApi.list();
  expect(get).toHaveBeenCalledWith('/billing');
  await billingApi.connect('claude', 'Work', 'session-fixture');
  expect(post).toHaveBeenLastCalledWith('/billing/connections', {
    provider: 'claude',
    label: 'Work',
    session: 'session-fixture',
  });
  await billingApi.reconnect('login/id', 'new-session');
  expect(patch).toHaveBeenLastCalledWith('/billing/connections/login%2Fid', {
    session: 'new-session',
  });
  await billingApi.refresh('login');
  expect(post).toHaveBeenLastCalledWith('/billing/connections/login/refresh');
  await billingApi.disconnect('login');
  expect(del).toHaveBeenLastCalledWith('/billing/connections/login');
  await billingApi.bind('key-id', 'org');
  expect(put).toHaveBeenLastCalledWith('/billing/bindings', {
    credential_id: 'key-id',
    account_id: 'org',
  });
  await billingApi.unbind('key-id');
  expect(del).toHaveBeenLastCalledWith('/billing/bindings', {
    params: { credential_id: 'key-id' },
  });
  await billingApi.verify('key-id');
  expect(post).toHaveBeenLastCalledWith('/billing/credentials/verify', { credential_id: 'key-id' });
  expect(await billingApi.loginHelper()).toBe('# helper');
  expect(raw).toHaveBeenCalledWith('/billing/login-helper', { responseType: 'text' });
});

test('Billing page provides masked manual import, credential verification, and guarded async actions without persistence', async () => {
  const source = await Bun.file(
    new URL('../src/features/billing/BillingPage.tsx', import.meta.url)
  ).text();
  expect(source).toContain('type="password"');
  expect(source).toContain('autoComplete="off"');
  expect(source).toContain('billingApi.verify');
  expect(source).toContain('billingApi.unbind');
  expect(source).toContain('createBillingRequestGuard');
  expect(source).not.toMatch(/localStorage|sessionStorage|console\.log|error\.message/);
});

test('all five active locales translate the billing interface and navigation', async () => {
  const en = await Bun.file(new URL('../src/i18n/locales/en.json', import.meta.url)).json();
  expect(en.billing).toBeDefined();
  for (const locale of ['zh-CN', 'zh-TW', 'ru', 'vi']) {
    const data = await Bun.file(
      new URL(`../src/i18n/locales/${locale}.json`, import.meta.url)
    ).json();
    expect(Object.keys(data.billing ?? {}).sort()).toEqual(Object.keys(en.billing).sort());
    expect(data.nav.billing).toBeTruthy();
    expect(data.nav_meta.billing).toBeTruthy();
  }
});

test('preserves only safe billing error codes and never provider response text', () => {
  const data = normalizeBillingSnapshot({
    ...fixture,
    connections: [{ ...fixture.connections[0], error: 'session_expired' }],
    accounts: [
      { ...fixture.accounts[0], error: 'unsupported_endpoint' },
      { ...fixture.accounts[1], error: 'Bearer secret-fixture' },
    ],
  });
  expect(data.connections[0].error).toBe('session_expired');
  expect(data.accounts[0].error).toBe('unsupported_endpoint');
  expect(data.accounts[1].error).toBeNull();
  expect(JSON.stringify(data)).not.toContain('secret-fixture');
});

test('maps actionable errors to fixed translations without reflecting arbitrary text', async () => {
  const { billingErrorKey } = await import('@/services/api/billing');
  for (const code of [
    'organization_mismatch',
    'partial_billing_access',
    'unsupported_endpoint',
    'session_expired',
    'permission_denied',
    'storage_conflict',
  ]) {
    expect(billingErrorKey({ apiCode: code })).toBe(`billing.error_${code}`);
  }
  expect(billingErrorKey({ details: { error: 'session_expired' } })).toBe(
    'billing.error_session_expired'
  );
  expect(billingErrorKey(new Error('Bearer secret-fixture'))).toBe('billing.action_failed');
});

test('ready balances age to stale after five minutes while explicit unknown and reconnect states survive', async () => {
  const { billingAccountStatus } = await import('@/features/billing/logic');
  const account = {
    ...normalizeBillingSnapshot(fixture).accounts[0],
    status: 'ready' as const,
    observedAt: '2026-02-01T00:00:00Z',
  };
  expect(billingAccountStatus(account, Date.parse('2026-02-01T00:04:59Z'))).toBe('ready');
  expect(billingAccountStatus(account, Date.parse('2026-02-01T00:05:01Z'))).toBe('stale');
  expect(
    billingAccountStatus(
      { ...account, status: 'reconnect_required' },
      Date.parse('2026-02-02T00:00:00Z')
    )
  ).toBe('reconnect_required');
  expect(
    billingAccountStatus({ ...account, observedAt: null }, Date.parse('2026-02-02T00:00:00Z'))
  ).toBe('unknown');
  const markup = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n: billingI18n },
      createElement(BillingAccounts, {
        accounts: [{ ...account, error: 'unsupported_endpoint' }],
        now: Date.parse('2026-02-01T00:05:01Z'),
      })
    )
  );
  expect(markup).toContain('Stale');
  expect(markup).toContain('Console billing endpoint is unavailable');
  expect(markup).not.toContain('Fresh');
});

test('expired connections still allow disconnect to remove stored session material', async () => {
  const source = await Bun.file(
    new URL('../src/features/billing/BillingPage.tsx', import.meta.url)
  ).text();
  expect(source).toMatch(/variant="danger"\s+disabled=\{busy\}/);
});
