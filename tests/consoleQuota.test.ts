import { expect, test } from 'bun:test';
import type { BillingAccount, BillingSnapshot } from '@/services/api/billing';
import { classifyQuotaFiles, paginate } from '@/features/quota/logic';
import {
  buildQuotaBoard,
  filterQuotaBoard,
  quotaBoardCounts,
  sortQuotaBoard,
  consoleQuotaStatus,
  nextCreditExpiryMs,
  type ConsoleQuotaEntry,
} from '@/features/quota/consoleQuota';
import { isQuotaTabId, isQuotaSortMode } from '@/features/quota/uiState';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const account = (
  provider: 'claude' | 'openai',
  extra: Partial<BillingAccount> = {}
): BillingAccount => ({
  id: `${provider}:shared`,
  provider,
  organizationId: 'shared',
  name: `${provider} organization`,
  connectionId: `${provider}-login`,
  balance: 25,
  currency: 'USD',
  observedAt: new Date(NOW).toISOString(),
  status: 'ready',
  error: null,
  grants: [
    {
      id: 'promo',
      name: 'Promotion',
      kind: 'promo',
      amount: 50,
      remaining: 25,
      expiresAt: '2026-11-10T13:00:00Z',
    },
  ],
  ...extra,
});
const snapshot = (): BillingSnapshot => ({
  accounts: [account('claude'), account('claude'), account('openai')],
  connections: ['claude', 'openai'].map((provider) => ({
    id: `${provider}-login`,
    provider: provider as 'claude' | 'openai',
    label: `${provider} login`,
    status: 'ready',
    accountIds: [`${provider}:shared`],
    updatedAt: new Date(NOW).toISOString(),
    error: null,
  })),
  credentials: [
    {
      id: 'key-one',
      label: 'Named primary',
      provider: 'claude',
      organizationId: 'shared',
      verificationStatus: 'verified',
    },
    {
      id: 'key-two',
      label: 'Named fallback',
      provider: 'claude',
      organizationId: 'shared',
      verificationStatus: 'verified',
    },
    {
      id: 'private-id-not-searchable',
      label: 'OpenAI paid',
      provider: 'openai',
      organizationId: 'shared',
      verificationStatus: 'verified',
    },
  ],
  bindings: [
    { credentialId: 'key-one', accountId: 'claude:shared', verified: true },
    { credentialId: 'key-two', accountId: 'claude:shared', verified: false },
    { credentialId: 'key-one', accountId: 'claude:shared', verified: true },
    { credentialId: 'private-id-not-searchable', accountId: 'openai:shared', verified: true },
    { credentialId: 'private-id-not-searchable', accountId: 'claude:shared', verified: true },
  ],
});
const files = classifyQuotaFiles([
  { name: 'claude.json', provider: 'claude', email: 'oauth@example.test' },
  { name: 'codex.json', provider: 'codex' },
  { name: 'kimi.json', provider: 'kimi' },
]);
const org = (provider: 'claude' | 'openai' = 'claude') =>
  buildQuotaBoard([], snapshot()).find(
    (e): e is ConsoleQuotaEntry => e.kind === 'console' && e.type === provider
  )!;

test('groups one shared credit pool per provider organization and derives verified linked names', () => {
  const board = buildQuotaBoard(files, snapshot());
  expect(board.map((e) => e.type)).toEqual(['claude', 'claude', 'codex', 'openai', 'kimi']);
  const entry = board.find(
    (e): e is ConsoleQuotaEntry => e.kind === 'console' && e.type === 'claude'
  )!;
  expect(entry.account.balance).toBe(25);
  expect(entry.credentials.map((c) => [c.label, c.verificationStatus])).toEqual([
    ['Named primary', 'verified'],
    ['Named fallback', 'unverified'],
  ]);
  expect(board.filter((e) => e.kind === 'console')).toHaveLength(2);
  expect(quotaBoardCounts(board)).toEqual({
    all: 5,
    claude: 2,
    antigravity: 0,
    codex: 1,
    openai: 1,
    xai: 0,
    kimi: 1,
    devin: 0,
    meta: 0,
  });
});

test('filters the shared grid using provider, organization, login and linked names without searching private fields', () => {
  const board = buildQuotaBoard(files, snapshot());
  expect(filterQuotaBoard(board, 'claude', '')).toHaveLength(2);
  expect(filterQuotaBoard(board, 'openai', '')).toHaveLength(1);
  expect(filterQuotaBoard(board, 'all', 'NAMED FALLBACK')).toHaveLength(1);
  expect(filterQuotaBoard(board, 'all', 'openai login')).toHaveLength(1);
  expect(filterQuotaBoard(board, 'all', 'oauth@')).toHaveLength(1);
  expect(filterQuotaBoard(board, 'all', 'private-id-not-searchable')).toHaveLength(0);
  expect(filterQuotaBoard(board, 'codex', 'Named primary')).toHaveLength(0);
});

test('credit expiry is separate from recovery and preserves stable unknown ordering', () => {
  const board = buildQuotaBoard(files, snapshot());
  const recover = () => NOW + 10 * 60_000;
  expect(sortQuotaBoard(board, 'soonest', recover, NOW).map((e) => e.kind)).toEqual([
    'oauth',
    'oauth',
    'oauth',
    'console',
    'console',
  ]);
  expect(sortQuotaBoard(board, 'expiry', recover, NOW).map((e) => e.type)).toEqual([
    'claude',
    'openai',
    'claude',
    'codex',
    'kimi',
  ]);
  expect(sortQuotaBoard(board, 'default', recover, NOW)).toEqual(board);
  expect(isQuotaTabId('openai')).toBe(true);
  expect(isQuotaSortMode('expiry')).toBe(true);
});

test('only fresh known positive credits establish future expiry', () => {
  const entry = org();
  expect(nextCreditExpiryMs(entry, NOW)).toBe(Date.parse('2026-11-10T13:00:00Z'));
  for (const changes of [
    { balance: 0 },
    { balance: null },
    { status: 'stale' as const },
    { observedAt: null },
    { observedAt: '2026-11-10T11:00:00Z' },
  ]) {
    expect(
      nextCreditExpiryMs({ ...entry, account: { ...entry.account, ...changes } }, NOW)
    ).toBeNull();
  }
  for (const grant of [
    { remaining: 0 },
    { remaining: null },
    { expiresAt: null },
    { expiresAt: '2026-11-10T11:00:00Z' },
  ]) {
    expect(
      nextCreditExpiryMs(
        {
          ...entry,
          account: { ...entry.account, grants: [{ ...entry.account.grants[0], ...grant }] },
        },
        NOW
      )
    ).toBeNull();
  }
  expect(consoleQuotaStatus({ ...entry, connection: undefined }, NOW)).toBe('reconnect_required');
  expect(
    consoleQuotaStatus(
      { ...entry, connection: { ...entry.connection!, status: 'reconnect_required' } },
      NOW
    )
  ).toBe('reconnect_required');
  expect(
    consoleQuotaStatus({ ...entry, account: { ...entry.account, observedAt: null } }, NOW)
  ).toBe('unknown');
});

test('organizations share pagination with OAuth without multiplying by linked keys', () => {
  const many = classifyQuotaFiles(
    Array.from({ length: 20 }, (_, i) => ({ name: `oauth-${i}.json`, provider: 'claude' }))
  );
  const board = buildQuotaBoard(many, snapshot());
  expect(board).toHaveLength(22);
  expect(paginate(board, 1, 20).pageItems).toHaveLength(20);
  expect(paginate(board, 2, 20).pageItems).toHaveLength(2);
  const unbound = snapshot();
  unbound.bindings = [];
  expect(buildQuotaBoard([], unbound)).toHaveLength(2);
});
