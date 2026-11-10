import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import en from '@/i18n/locales/en.json';
import { ConsoleQuotaCard } from '@/features/quota/components/ConsoleQuotaCard';
import type { ConsoleQuotaEntry } from '@/features/quota/consoleQuota';

const i18n = createInstance();
const now = Date.parse('2026-11-10T12:00:00Z');
const entry: ConsoleQuotaEntry = {
  kind: 'console',
  type: 'claude',
  account: {
    id: 'internal-account-id',
    provider: 'claude',
    organizationId: 'org-acme',
    name: 'Acme Labs',
    connectionId: 'internal-connection-id',
    balance: 42.5,
    currency: 'USD',
    grants: [],
    observedAt: '2026-11-10T11:59:00Z',
    status: 'ready',
    error: null,
  },
  connection: {
    id: 'internal-connection-id',
    provider: 'claude',
    label: 'Production Console',
    accountIds: ['internal-account-id'],
    status: 'ready',
    updatedAt: '2026-11-10T11:59:00Z',
    error: null,
  },
  credentials: [
    {
      id: 'internal-credential-id',
      label: 'Production API',
      provider: 'claude',
      organizationId: 'org-acme',
      verificationStatus: 'verified',
    },
    {
      id: 'internal-other-key-id',
      label: 'Staging API',
      provider: 'claude',
      organizationId: 'org-acme',
      verificationStatus: 'unverified',
    },
  ],
};

function renderCard(
  nextEntry: ConsoleQuotaEntry = entry,
  props: Partial<Parameters<typeof ConsoleQuotaCard>[0]> = {}
) {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(
        MemoryRouter,
        null,
        createElement(ConsoleQuotaCard, {
          entry: nextEntry,
          resolvedTheme: 'light',
          canRefresh: true,
          refreshing: false,
          onRefresh: () => {},
          now,
          ...props,
        })
      )
    )
  );
}

beforeAll(async () => {
  await i18n.init({
    lng: 'en',
    resources: { en: { translation: en } },
    interpolation: { escapeValue: false },
  });
});

describe('Console organization quota card', () => {
  test('shows the organization USD pool once with linked credential labels and verification', () => {
    const markup = renderCard();
    expect(markup).toContain('Acme Labs');
    expect(markup).toContain('org-acme');
    expect(markup).toContain('API / Console');
    expect(markup.match(/\$42\.50/g)).toHaveLength(1);
    expect(markup).toContain('Shared organization balance');
    expect(markup).toContain('Production API');
    expect(markup).toContain('Staging API');
    expect(markup).toContain('Verified');
    expect(markup).toContain('Unverified');
    expect(markup).not.toContain('internal-credential-id');
    expect(markup).not.toContain('internal-account-id');
    expect(markup).not.toContain('internal-connection-id');
    expect(markup).not.toContain('progressbar');
  });

  test('distinguishes a known zero balance from unknown', () => {
    const zero = renderCard({ ...entry, account: { ...entry.account, balance: 0 } });
    const unknown = renderCard({ ...entry, account: { ...entry.account, balance: null } });
    expect(zero).toContain('$0.00');
    expect(unknown).toContain('Unknown');
    expect(unknown).not.toContain('$0.00');
  });

  test('shows granted and remaining amounts with real future, expired and unknown expiry', () => {
    const markup = renderCard({
      ...entry,
      account: {
        ...entry.account,
        grants: [
          {
            id: 'grant-1',
            name: 'Trial credits',
            kind: 'trial',
            amount: 100,
            remaining: 25,
            expiresAt: '2026-11-12T12:00:00Z',
          },
          {
            id: 'grant-2',
            name: 'Old credits',
            kind: 'paid',
            amount: 10,
            remaining: 0,
            expiresAt: '2026-11-09T12:00:00Z',
          },
          {
            id: 'grant-3',
            name: 'Undated credits',
            kind: 'paid',
            amount: null,
            remaining: null,
            expiresAt: null,
          },
        ],
      },
    });
    expect(markup).toContain('Trial credits');
    expect(markup).toContain('$100.00');
    expect(markup).toContain('$25.00');
    expect(markup).toContain('in 2 days');
    expect(markup).toMatch(/datetime="2026-11-12T12:00:00Z"/i);
    expect(markup).toContain('Expired');
    expect(markup).toContain('Expiry unknown');
    expect(markup).not.toMatch(/reset|protection/i);
  });

  test('retains stale balances and observed time while guiding reconnect through Billing', () => {
    const stale = renderCard({
      ...entry,
      account: { ...entry.account, observedAt: '2026-11-10T11:50:00Z' },
    });
    expect(stale).toContain('$42.50');
    expect(stale).toContain('Stale');
    expect(stale).toContain('10 minutes ago');
    expect(stale).toMatch(/datetime="2026-11-10T11:50:00Z"/i);
    const reconnect = renderCard({
      ...entry,
      connection: { ...entry.connection!, status: 'reconnect_required', error: 'session_expired' },
    });
    expect(reconnect).toContain('Reconnect required');
    expect(reconnect).toContain('href="/billing"');
    expect(reconnect).toContain('Reconnect in Billing');
    expect(reconnect).not.toContain('session_expired');
    expect(reconnect).toMatch(/<button[^>]*disabled=""/);
  });

  test('disables refresh while busy, unavailable or missing a Console connection', () => {
    expect(renderCard(entry, { refreshing: true })).toMatch(
      /<button[^>]*disabled=""[^>]*aria-busy="true"/
    );
    expect(renderCard(entry, { canRefresh: false })).toMatch(/<button[^>]*disabled=""/);
    expect(renderCard({ ...entry, connection: undefined })).toMatch(/<button[^>]*disabled=""/);
    expect(renderCard()).not.toMatch(/<button[^>]*disabled/);
  });

  test('displays safe error messages without rendering unknown error bodies or extra fields', () => {
    const unsafeEntry = {
      ...entry,
      account: { ...entry.account, error: 'secret-session-body', session: 'private-cookie' },
      credentials: [{ ...entry.credentials[0], token: 'sk-private-key' }],
    };
    const markup = renderCard(unsafeEntry, { errorKey: 'unsafe-secret-error' });
    expect(markup).toContain('Could not refresh this Console balance.');
    for (const secret of [
      'secret-session-body',
      'private-cookie',
      'sk-private-key',
      'unsafe-secret-error',
    ]) {
      expect(markup).not.toContain(secret);
    }
    expect(
      renderCard({ ...entry, account: { ...entry.account, error: 'permission_denied' } })
    ).toContain('lacks permission');
  });

  test('keeps OpenAI API organization balances separate from Codex OAuth terminology', () => {
    const markup = renderCard({
      ...entry,
      type: 'openai',
      account: { ...entry.account, provider: 'openai' },
      credentials: [],
    });
    expect(markup).toContain('OpenAI API');
    expect(markup).toContain('No linked API credentials');
    expect(markup).toContain('Manage in Billing');
    expect(markup.replace(/<[^>]*>/g, '')).not.toMatch(/Codex|OAuth|5.hour|weekly/i);
  });
});
