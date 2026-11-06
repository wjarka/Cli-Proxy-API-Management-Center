import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import { normalizeQuotaReserves, quotaReservesApi } from '@/services/api/quotaReserves';
import { normalizeQuotaUsagePolicies } from '@/services/api/quotaUsagePolicies';
import { QuotaUsageDetails } from '@/features/quota/components/QuotaUsageDetails';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { CodexQuotaBody } from '@/features/quota/providers/codex/CodexQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';

const policy = {
  timezone: 'Europe/Warsaw',
  'protected-budget-percent': 30,
  schedule: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], start: '09:00', end: '17:00' }],
};
const routing = {
  'usage-policies': { 'work-hours': policy },
  'account-policies': [{ account: 'work.json', 'usage-policy': 'work-hours' }],
};
const live = {
  policy: 'work-hours',
  protected_percent: 30,
  remaining_percent: 20,
  active: true,
  active_until: '2026-11-06T17:00:00+01:00',
  blocked: true,
  reason: 'five_hour_limit',
};
const overview = (status: unknown = live) => ({
  accounts: [{ id: 'work.json', usage_policy: status }],
});
const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test'
);
const previousLanguage = i18n.language;
beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

test('weekly normalization accepts a usage-only binding without inventing a weekly reserve', () => {
  expect(Object.keys(normalizeQuotaReserves(routing, overview()))).toEqual([]);
});

test('joins 5h protection by exact credential ID and normalizes protection and schedule', () => {
  const result = normalizeQuotaUsagePolicies(routing, overview());
  expect(Object.keys(result)).toEqual(['work.json']);
  expect(result['work.json']).toMatchObject({
    policy: 'work-hours',
    timezone: 'Europe/Warsaw',
    protectedPercent: 30,
    configuredPercent: 30,
    remainingPercent: 20,
    active: true,
    status: 'reserved',
    schedule: policy.schedule,
  });
  expect(
    normalizeQuotaUsagePolicies(routing, { accounts: [{ id: 'other.json', usage_policy: live }] })[
      'work.json'
    ].status
  ).toBe('unavailable');
  expect(
    normalizeQuotaUsagePolicies(routing, overview({ ...live, policy: 'other' }))['work.json'].status
  ).toBe('unavailable');
});

test('shows known protection when quota is unknown, without claiming allowance', () => {
  const usagePolicy = normalizeQuotaUsagePolicies(
    routing,
    overview({ ...live, remaining_percent: undefined, reason: 'quota_unknown' })
  )['work.json'];
  const markup = renderToStaticMarkup(
    createElement(QuotaUsageDetails, { usagePolicy, compact: false })
  );
  expect(markup).toContain('30% protected now');
  expect(markup).toContain('Proxy waiting for quota data');
  expect(markup).toContain('09:00');
  expect(markup).toContain('17:00');
  expect(markup).toContain('Mon, Tue, Wed, Thu, Fri');
  expect(markup).toContain('Europe/Warsaw');
  expect(markup).not.toContain('allows proxy use');
});

test('outside working hours shows zero protected now and retains configured protection', () => {
  const usagePolicy = normalizeQuotaUsagePolicies(
    routing,
    overview({
      ...live,
      active: false,
      blocked: false,
      active_until: '0001-01-01T00:00:00Z',
      reason: undefined,
    })
  )['work.json'];
  const markup = renderToStaticMarkup(
    createElement(QuotaUsageDetails, { usagePolicy, compact: false })
  );
  expect(usagePolicy.protectedPercent).toBe(0);
  expect(markup).toContain('0% protected now');
  expect(markup).toContain('Outside protected hours');
  expect(markup).toContain('30% during protected hours');
  expect(markup).not.toContain('0001');
});

test('shows configured protection without fabricating current protection after failed overview', () => {
  const usagePolicy = normalizeQuotaUsagePolicies(routing, null)['work.json'];
  const markup = renderToStaticMarkup(
    createElement(QuotaUsageDetails, { usagePolicy, compact: false })
  );
  expect(usagePolicy.protectedPercent).toBeNull();
  expect(markup).toContain('Protected amount unknown');
  expect(markup).toContain('30% during protected hours');
  expect(markup).toContain('Protection status unavailable');
});

test('loads overview for usage-only accounts and shares it with weekly protection', async () => {
  const get = spyOn(apiClient, 'get')
    .mockResolvedValueOnce(routing)
    .mockResolvedValueOnce(overview());
  try {
    const result = await quotaReservesApi.getProtections();
    expect(result.usagePolicies['work.json'].protectedPercent).toBe(30);
    expect(Object.keys(result.reserves)).toEqual([]);
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/config/routing',
      '/credentials/quota-overview',
    ]);
  } finally {
    get.mockRestore();
  }
});

test('shades only the shared 5h window and keeps current protected percentage visible', () => {
  const usagePolicy = normalizeQuotaUsagePolicies(routing, overview())['work.json'];
  for (const Body of [ClaudeQuotaBody, CodexQuotaBody]) {
    const markup = renderToStaticMarkup(
      createElement(Body, {
        classes,
        usagePolicy,
        quota: {
          status: 'success',
          windows: [
            { id: 'five-hour', label: '5h', usedPercent: 80, resetLabel: '', periodHours: 5 },
            { id: 'seven-day', label: '7d', usedPercent: 80, resetLabel: '', periodHours: 168 },
            {
              id: 'code-review-five-hour',
              label: 'Review 5h',
              usedPercent: 80,
              resetLabel: '',
              periodHours: 5,
            },
          ],
        },
      })
    );
    expect(markup.match(/data-reserve-floor/g)).toHaveLength(1);
    expect(markup).toContain('data-reserve-floor="30"');
    expect(markup).toContain('data-reserve-shading="20"');
    expect(markup).toContain('30% protected now');
    expect(markup).toContain('5h protection');
  }
});

test('keeps protection visible when 5h usage is absent and removes inactive shading', () => {
  for (const active of [true, false]) {
    const usagePolicy = normalizeQuotaUsagePolicies(
      routing,
      overview({ ...live, active, blocked: active })
    )['work.json'];
    const markup = renderToStaticMarkup(
      createElement(ClaudeQuotaBody, {
        classes,
        usagePolicy,
        quota: { status: 'success', windows: [] },
      })
    );
    expect(markup).toContain(`${active ? 30 : 0}% protected now`);
    expect(markup).not.toContain('data-reserve-floor');
  }
});

test('legacy v8 consumed policy converts to protection and cannot hide the weekly reserve', async () => {
  const legacyRouting = {
    ...routing,
    'reserve-policies': {
      'work-week': {
        timezone: 'Europe/Warsaw',
        schedule: [{ days: ['fri'], 'protected-budget-percent': 15, 'release-at': '17:00' }],
      },
    },
    'usage-policies': {
      'work-hours': {
        ...policy,
        'protected-budget-percent': undefined,
        'five-hour-used-percent': 70,
      },
    },
    'account-policies': [
      { account: 'work.json', 'reserve-policy': 'work-week', 'usage-policy': 'work-hours' },
    ],
  };
  const get = spyOn(apiClient, 'get')
    .mockResolvedValueOnce(legacyRouting)
    .mockResolvedValueOnce({
      accounts: [
        {
          id: 'work.json',
          usage_policy: live,
          reserve: {
            policy: 'work-week',
            protected_percent: 45,
            remaining_percent: 46,
            blocked: false,
          },
        },
      ],
    });
  try {
    const result = await quotaReservesApi.getProtections();
    expect(result.usagePolicies['work.json'].configuredPercent).toBe(30);
    expect(result.usagePolicies['work.json'].protectedPercent).toBe(30);
    expect(result.reserves['work.json'].protectedPercent).toBe(45);
  } finally {
    get.mockRestore();
  }
});

test('validates percentages and schedules consistently with the backend', () => {
  for (const change of [
    { 'protected-budget-percent': -1 },
    { 'protected-budget-percent': 101 },
    { 'protected-budget-percent': NaN },
    { 'protected-budget-percent': undefined },
    { 'five-hour-used-percent': 70 },
    { timezone: 'Invalid/Zone' },
    { schedule: [] },
    { schedule: [{ days: ['bad'], start: '09:00', end: '17:00' }] },
    { schedule: [{ days: ['mon'], start: '17:00', end: '09:00' }] },
  ]) {
    expect(() =>
      normalizeQuotaUsagePolicies(
        { ...routing, 'usage-policies': { 'work-hours': { ...policy, ...change } } },
        overview()
      )
    ).toThrow();
  }
});
