import { describe, expect, test } from 'bun:test';
import { ConsoleQuotaController } from '../src/features/quota/consoleQuotaController';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const observation = (balance = 12, status = 'ready', error: string | null = null) => ({
  connections: [
    {
      id: 'shared/a',
      provider: 'claude',
      label: 'Work',
      status,
      account_ids: ['org-a', 'org-b'],
      updated_at: '2026-11-10T12:00:00Z',
      error,
    },
  ],
  accounts: ['a', 'b'].map((suffix) => ({
    id: `org-${suffix}`,
    provider: 'claude',
    organization_id: suffix,
    name: suffix,
    connection_id: 'shared/a',
    balance,
    currency: 'USD',
    observed_at: '2026-11-10T12:00:00Z',
    status,
    error,
    grants: [],
  })),
  bindings: [{ credential_id: 'key-a', account_id: 'org-a', verified: true }],
  credentials: [
    {
      id: 'key-a',
      label: 'Key A',
      provider: 'claude',
      organization_id: 'a',
      verification_status: 'verified',
    },
  ],
});

function harness() {
  const calls: {
    method: string;
    path: string;
    signal: AbortSignal;
    response: ReturnType<typeof deferred<unknown>>;
  }[] = [];
  let revision = 0;
  const send = (method: string, path: string, signal: AbortSignal) => {
    const response = deferred<unknown>();
    calls.push({ method, path, signal, response });
    return response.promise;
  };
  const controller = new ConsoleQuotaController({
    transport: {
      get: (path, config) => send('GET', path, config.signal),
      post: (path, _data, config) => send('POST', path, config.signal),
    },
    isCurrent: () => revision === 0,
    onChange: () => {},
  });
  const load = async () => {
    const pending = controller.reload();
    expect(calls.length).toBeGreaterThan(0);
    calls.at(-1)!.response.resolve(observation());
    await pending;
  };
  return {
    controller,
    calls,
    load,
    invalidate: () => {
      revision += 1;
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

describe('Console quota controller', () => {
  test('loads normalized organizations and retains the last observation after a list failure', async () => {
    const { controller, calls, load } = harness();
    await load();
    expect(
      controller.getState().snapshot.accounts.map((account) => account.organizationId)
    ).toEqual(['a', 'b']);
    expect(controller.getState().snapshot.accounts[0].balance).toBe(12);
    const pending = controller.reload();
    expect(controller.getState().loading).toBe(true);
    calls[1].response.reject(new Error('private provider body'));
    await pending;
    expect(controller.getState().errorKey).toBe('console_quota.load_failed');
    expect(controller.getState().snapshot.accounts[0].balance).toBe(12);
    expect(controller.getState().loading).toBe(false);
  });

  test('refreshes a shared connection once, ignores unknown IDs, and reloads once after settling', async () => {
    const { controller, calls, load } = harness();
    await load();
    const first = controller.refreshConnections(['shared/a', 'shared/a', 'unknown']);
    const duplicate = controller.refreshConnections(['shared/a']);
    expect(calls.map(({ method, path }) => [method, path])).toEqual([
      ['GET', '/billing'],
      ['POST', '/billing/connections/shared%2Fa/refresh'],
    ]);
    expect([...controller.getState().refreshingIds]).toEqual(['shared/a']);
    calls[1].response.resolve({ status: 'ok' });
    await flush();
    expect(calls.length).toBe(3);
    calls[2].response.resolve(observation(25));
    await Promise.all([first, duplicate]);
    expect(controller.getState().snapshot.accounts[1].balance).toBe(25);
    expect(controller.getState().refreshingIds.size).toBe(0);
  });

  test('waits for all distinct refreshes before the batch observation reload', async () => {
    const { controller, calls } = harness();
    const initial = controller.reload();
    const snapshot = observation();
    snapshot.connections.push({ ...snapshot.connections[0], id: 'other' });
    expect(calls.length).toBe(1);
    calls[0].response.resolve(snapshot);
    await initial;
    const pending = controller.refreshConnections(['shared/a', 'other']);
    calls[1].response.resolve({ status: 'ok' });
    await flush();
    expect(calls.length).toBe(3);
    expect(controller.getState().refreshingIds.size).toBe(2);
    calls[2].response.resolve({ status: 'ok' });
    await flush();
    expect(calls.length).toBe(4);
    calls[3].response.resolve(observation(30));
    await pending;
    expect(controller.getState().snapshot.accounts[0].balance).toBe(30);
  });

  test('keeps only safe refresh error keys and reloads retained balances and bindings after failure', async () => {
    const { controller, calls, load } = harness();
    await load();
    const pending = controller.refreshConnections(['shared/a']);
    calls[1].response.reject({ apiCode: 'session_expired', details: { token: 'private' } });
    await flush();
    expect(calls[2].path).toBe('/billing');
    calls[2].response.resolve(observation(12, 'reconnect_required', 'session_expired'));
    await pending;
    expect(controller.getState().actionErrors).toEqual({
      'shared/a': 'billing.error_session_expired',
    });
    expect(controller.getState().snapshot.accounts[0].balance).toBe(12);
    expect(controller.getState().snapshot.accounts[0].status).toBe('reconnect_required');
    expect(controller.getState().snapshot.bindings).toEqual([
      { credentialId: 'key-a', accountId: 'org-a', verified: true },
    ]);
    const unrelated = controller.reload();
    calls[3].response.resolve(observation(12, 'reconnect_required', 'session_expired'));
    await unrelated;
    expect(controller.getState().actionErrors['shared/a']).toBe('billing.error_session_expired');
    const retry = controller.refreshConnections(['shared/a']);
    expect(controller.getState().actionErrors).toEqual({});
    calls[4].response.resolve({ status: 'ok' });
    await flush();
    calls[5].response.resolve(observation(22));
    await retry;
    expect(controller.getState().actionErrors).toEqual({});
  });

  test('a later list request wins even when an older response arrives last', async () => {
    const { controller, calls } = harness();
    const older = controller.reload();
    const newer = controller.reload();
    expect(calls.length).toBe(2);
    calls[1].response.resolve(observation(20));
    await newer;
    calls[0].response.resolve(observation(1));
    await older;
    expect(controller.getState().snapshot.accounts[0].balance).toBe(20);
    expect(controller.getState().loading).toBe(false);
  });

  test('a late failed list request cannot replace newer success with an error', async () => {
    const { controller, calls } = harness();
    const older = controller.reload();
    const newer = controller.reload();
    expect(calls.length).toBe(2);
    calls[1].response.resolve(observation(20));
    await newer;
    calls[0].response.reject(new Error('old failure'));
    await older;
    expect(controller.getState().errorKey).toBeNull();
  });

  test('dispose aborts the pending list and prevents stale callbacks from posting', async () => {
    const { controller, calls } = harness();
    const pending = controller.reload();
    controller.dispose();
    expect(calls.length).toBe(1);
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].response.resolve(observation());
    await pending;
    await controller.reload();
    await controller.refreshConnections(['shared/a']);
    expect(calls.length).toBe(1);
    expect(controller.getState().snapshot.accounts).toEqual([]);
  });

  test('dispose during refresh prevents its late result from starting another list request', async () => {
    const { controller, calls, load } = harness();
    await load();
    const pending = controller.refreshConnections(['shared/a']);
    controller.dispose();
    calls[1].response.reject({ apiCode: 'permission_denied' });
    await pending;
    expect(calls.length).toBe(2);
    expect(calls[1].signal.aborted).toBe(true);
    expect(controller.getState().actionErrors).toEqual({});
  });

  test('monotonic scope invalidation rejects a pending list even after returning to the same server', async () => {
    const { controller, calls, invalidate } = harness();
    const pending = controller.reload();
    invalidate();
    expect(calls.length).toBe(1);
    calls[0].response.resolve(observation());
    await pending;
    await controller.refreshConnections(['shared/a']);
    await controller.reload();
    expect(calls.length).toBe(1);
    expect(controller.getState().snapshot.accounts).toEqual([]);
  });

  test('scope invalidation while refreshing blocks reload and late action callbacks', async () => {
    const { controller, calls, load, invalidate } = harness();
    await load();
    const pending = controller.refreshConnections(['shared/a']);
    invalidate();
    calls[1].response.resolve({ status: 'ok' });
    await pending;
    await controller.refreshConnections(['shared/a']);
    expect(calls.length).toBe(2);
    expect(controller.getState().actionErrors).toEqual({});
  });
});

test('refresh-all retries a failed initial snapshot when there are no visible Console IDs', async () => {
  const { controller, calls } = harness();
  const initial = controller.reload();
  calls[0].response.reject(new Error('unavailable'));
  await initial;
  expect(controller.getState().snapshot.accounts).toHaveLength(0);
  const retry = controller.refreshConnections([]);
  expect(calls.map(({ method, path }) => [method, path])).toEqual([
    ['GET', '/billing'],
    ['GET', '/billing'],
  ]);
  calls[1].response.resolve(observation());
  await retry;
  expect(controller.getState().errorKey).toBeNull();
  expect(controller.getState().snapshot.accounts).toHaveLength(2);
});
