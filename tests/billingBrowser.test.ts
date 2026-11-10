import { expect, test } from 'bun:test';
import * as billing from '@/services/api/billing';
import * as logic from '@/features/billing/logic';
import { apiClient } from '@/services/api/client';

const wire = {
  id: 'opaque-id',
  provider: 'claude',
  status: 'ready',
  expires_at: '2026-11-10T12:15:00Z',
};

test('browser contract discards tokens and rejects invalid IDs, providers and non-finite expiry', () => {
  expect(typeof billing.normalizeBrowserSession).toBe('function');
  expect(
    billing.normalizeBrowserSession({
      ...wire,
      session: 'secret-fixture',
      ticket: 'secret-fixture',
    })
  ).toEqual({
    id: 'opaque-id',
    provider: 'claude',
    status: 'ready',
    expiresAt: '2026-11-10T12:15:00Z',
  });
  for (const invalid of [
    { ...wire, id: '' },
    { ...wire, provider: 'google' },
    { ...wire, expires_at: 'Infinity' },
    { ...wire, status: 'starting' },
  ]) {
    expect(() => billing.normalizeBrowserSession(invalid)).toThrow();
  }
  expect(billing.billingErrorKey({ apiCode: 'login_not_ready' })).toBe('billing.browser_not_ready');
  expect(billing.billingErrorKey({ apiCode: 'browser_expired' })).toBe('billing.browser_expired');
});

test('viewer URL preserves reverse proxy base, uses v8 once and never carries a ticket or key', () => {
  expect(typeof logic.browserViewerUrl).toBe('function');
  expect(logic.browserViewerUrl('https://proxy.invalid/sub/v8/management', 'opaque id')).toBe(
    'wss://proxy.invalid/sub/v8/management/billing/browser/sessions/opaque%20id/view'
  );
  expect(logic.browserViewerUrl('http://localhost:8317', 'opaque')).toBe(
    'ws://localhost:8317/v8/management/billing/browser/sessions/opaque/view'
  );
});

test('browser endpoints normalize payloads and keep reconnect identity in create', async () => {
  expect(typeof billing.createBillingBrowserApi).toBe('function');
  const requests: unknown[] = [];
  const transport = {
    get: async () => ({ available: true, max_sessions: 3, ttl_seconds: 900 }),
    post: async (path: string, body?: unknown) => {
      requests.push([path, body]);
      return path.endsWith('/view-ticket')
        ? { ticket: 'opaque-ticket' }
        : path.endsWith('/finish')
          ? { status: 'ok', connection_id: 'existing' }
          : wire;
    },
    delete: async () => ({ status: 'ok' }),
  };
  const api = billing.createBillingBrowserApi(transport);
  expect(await api.capability()).toEqual({ available: true, maxSessions: 3, ttlSeconds: 900 });
  expect(
    await api.create({ provider: 'claude', label: 'Existing', connectionId: 'existing' })
  ).toEqual({ id: 'opaque-id', provider: 'claude', status: 'ready', expiresAt: wire.expires_at });
  expect(await api.ticket('opaque-id')).toBe('opaque-ticket');
  expect(await api.finish('opaque-id')).toBe('existing');
  expect(requests).toEqual([
    [
      '/billing/browser/sessions',
      { provider: 'claude', label: 'Existing', connection_id: 'existing' },
    ],
    ['/billing/browser/sessions/opaque-id/view-ticket', undefined],
    ['/billing/browser/sessions/opaque-id/finish', undefined],
  ]);
});

test('late create is deleted through original scope after cancellation, unmount or API revision change', async () => {
  expect(typeof logic.createBrowserLoginFlow).toBe('function');
  for (const reason of ['cancel', 'dispose', 'revision']) {
    let resolve!: (value: unknown) => void;
    let revision = 1;
    const deleted: string[] = [];
    const states: unknown[] = [];
    const flow = logic.createBrowserLoginFlow(
      {
        create: () =>
          new Promise((r) => {
            resolve = r;
          }),
        remove: async (id: string) => {
          deleted.push(id);
        },
        finish: async () => 'existing',
      },
      () => revision === 1,
      (state: unknown) => states.push(state)
    );
    const pending = flow.start({ provider: 'claude', label: 'New' });
    if (reason === 'revision') revision = 2;
    else flow[reason]();
    resolve({
      id: 'old-server-id',
      provider: 'claude',
      status: 'ready',
      expiresAt: wire.expires_at,
    });
    await pending;
    expect(deleted).toEqual(['old-server-id']);
    expect(flow.session).toBeNull();
  }
});

test('not-ready finish retains browser; success returns same connection and clears temporary session', async () => {
  expect(typeof logic.createBrowserLoginFlow).toBe('function');
  let ready = false;
  const deleted: string[] = [];
  const flow = logic.createBrowserLoginFlow(
    {
      create: async () => ({
        id: 'opaque-id',
        provider: 'claude',
        status: 'ready',
        expiresAt: wire.expires_at,
      }),
      remove: async (id: string) => {
        deleted.push(id);
      },
      finish: async () => {
        if (!ready) throw { apiCode: 'login_not_ready' };
        return 'existing';
      },
    },
    () => true,
    () => {}
  );
  await flow.start({ provider: 'claude', label: 'Existing', connectionId: 'existing' });
  await expect(flow.finish()).rejects.toEqual({ apiCode: 'login_not_ready' });
  expect(flow.session?.id).toBe('opaque-id');
  ready = true;
  expect(await flow.finish()).toBe('existing');
  expect(flow.session).toBeNull();
});

test('scoped management transport stays on original authenticated connection after switching', async () => {
  expect(typeof apiClient.createConnectionScope).toBe('function');
  apiClient.setConfig({ apiBase: 'https://old.invalid/sub', managementKey: 'old-fixture' });
  const scope = apiClient.createConnectionScope();
  apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'new-fixture' });
  const instance = (scope as unknown as { instance: { defaults: { adapter: unknown } } }).instance;
  instance.defaults.adapter = async (config: {
    baseURL: string;
    headers: Record<string, string>;
  }) => ({
    data: { base: config.baseURL, auth: config.headers.Authorization },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  });
  expect(await scope.delete('/billing/browser/sessions/old')).toEqual({
    base: 'https://old.invalid/sub/v8/management',
    auth: 'Bearer old-fixture',
  });
});

test('effect teardown and setup replay accepts a fresh start while rejecting prior generation', async () => {
  let resolve!: (value: unknown) => void;
  let calls = 0;
  const deleted: string[] = [];
  const flow = logic.createBrowserLoginFlow(
    {
      create: async () =>
        ++calls === 1
          ? new Promise((r) => {
              resolve = r;
            })
          : { id: 'fresh', provider: 'claude', status: 'ready', expiresAt: wire.expires_at },
      remove: async (id: string) => {
        deleted.push(id);
      },
      finish: async () => 'saved',
    },
    () => true,
    () => {}
  );
  const pending = flow.start({ provider: 'claude', label: 'Old' });
  flow.dispose();
  expect(typeof flow.activate).toBe('function');
  flow.activate();
  await flow.start({ provider: 'claude', label: 'Fresh' });
  resolve({ id: 'late', provider: 'claude', status: 'ready', expiresAt: wire.expires_at });
  await pending;
  expect(flow.session?.id).toBe('fresh');
  expect(deleted).toEqual(['late']);
});
