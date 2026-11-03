import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import {
  normalizeQuotaReserves,
  quotaReservesApi,
  quotaReserveForFile,
} from '@/services/api/quotaReserves';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { CodexQuotaBody } from '@/features/quota/providers/codex/CodexQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { QuotaReserveDetails } from '@/features/quota/components/QuotaReserveDetails';

const routing = {
  'reserve-policies': {
    'work-account': {
      timezone: 'Europe/Warsaw',
      schedule: [
        {
          days: ['mon', 'tue', 'wed', 'thu', 'fri'],
          'protected-budget-percent': 15,
          'release-at': '17:00',
        },
      ],
    },
  },
  'account-policies': [{ account: 'work.json', 'reserve-policy': 'work-account' }],
};
const overview = {
  accounts: [
    {
      id: 'work.json',
      reserve: {
        policy: 'work-account',
        protected_percent: 30,
        remaining_percent: 21,
        blocked: true,
        reason: 'quota_reserved',
        observed_at: '2026-11-02T09:00:00Z',
        next_release_at: '2026-11-02T16:00:00Z',
      },
    },
    { id: 'personal.json' },
  ],
};

const previousLanguage = i18n.language;
beforeAll(async () => {
  await i18n.changeLanguage('en');
});
afterAll(async () => {
  await i18n.changeLanguage(previousLanguage);
});

describe('main Quota page reserve restrictions', () => {
  test('uses the backend credential ID, including when its display filename differs', () => {
    const reserve = normalizeQuotaReserves(routing, overview)['work.json'];
    const other = { ...reserve, policy: 'other-account' };
    const reserves = { 'work.json': reserve, 'Work.json': other };
    expect(quotaReserveForFile(reserves, { id: 'work.json', name: 'Work.json' })).toBe(reserve);
    expect(
      quotaReserveForFile(reserves, { id: 'different.json', name: 'Work.json' })
    ).toBeUndefined();
    expect(quotaReserveForFile(reserves, { name: 'Work.json' })).toBe(other);
    expect(quotaReserveForFile(reserves, { id: '', name: 'Work.json' })).toBe(other);
  });
  test('joins exact credential bindings with live status and the configured daily schedule', () => {
    const reserves = normalizeQuotaReserves(routing, overview);
    expect(Object.keys(reserves)).toEqual(['work.json']);
    expect(reserves['work.json']).toMatchObject({
      policy: 'work-account',
      timezone: 'Europe/Warsaw',
      protectedPercent: 30,
      remainingPercent: 21,
      status: 'reserved',
      schedule: [{ days: ['mon', 'tue', 'wed', 'thu', 'fri'], percent: 15, releaseAt: '17:00' }],
    });
    expect(reserves['personal.json']).toBeUndefined();
  });

  test('keeps the schedule visible after final release without rendering a year-one deadline', () => {
    const reserves = normalizeQuotaReserves(routing, {
      accounts: [
        {
          id: 'work.json',
          reserve: {
            policy: 'work-account',
            protected_percent: 0,
            remaining_percent: 21,
            blocked: false,
            next_release_at: '0001-01-01T00:00:00Z',
          },
        },
      ],
    });
    const markup = renderToStaticMarkup(
      createElement(QuotaReserveDetails, { reserve: reserves['work.json'] })
    );
    expect(markup).toContain('0% protected now');
    expect(markup).toContain('15% per day');
    expect(markup).toContain('17:00');
    expect(markup).toContain('Europe/Warsaw');
    expect(markup).not.toContain('Next release');
    expect(markup).not.toContain('0001');
  });

  test('renders the restriction and release in the policy timezone', () => {
    const reserve = normalizeQuotaReserves(routing, overview)['work.json'];
    const markup = renderToStaticMarkup(createElement(QuotaReserveDetails, { reserve }));
    expect(markup).toContain('30% protected now');
    expect(markup).toContain('Proxy blocked by reserve');
    expect(markup).toContain('Next release');
    expect(markup).toContain('17:00');
    expect(markup).toContain('Mon, Tue, Wed, Thu, Fri');
    expect(markup).toContain('Direct use can consume this reserve.');
  });

  test('does not fabricate an allowed status when observations are missing or invalid', () => {
    for (const input of [
      { accounts: [] },
      {
        accounts: [
          {
            id: 'work.json',
            reserve: {
              policy: 'work-account',
              protected_percent: NaN,
              blocked: false,
            },
          },
        ],
      },
    ]) {
      const reserve = normalizeQuotaReserves(routing, input)['work.json'];
      expect(reserve.status).toBe('unavailable');
      expect(reserve.protectedPercent).toBeNull();
      const markup = renderToStaticMarkup(createElement(QuotaReserveDetails, { reserve }));
      expect(markup).toContain('Reserve status unavailable');
      expect(markup).toContain('15% per day');
    }
  });

  test('distinguishes missing quota data from budget exhaustion', () => {
    const reserve = normalizeQuotaReserves(routing, {
      accounts: [
        {
          id: 'work.json',
          reserve: {
            policy: 'work-account',
            protected_percent: 75,
            reset_at: '2026-11-04T04:00:00Z',
            blocked: true,
            reason: 'quota_unknown',
          },
        },
      ],
    })['work.json'];
    const markup = renderToStaticMarkup(createElement(QuotaReserveDetails, { reserve }));
    expect(markup).toContain('Proxy waiting for quota data');
    expect(markup).not.toContain('Proxy blocked by reserve');
  });

  test('does not show a placeholder zero as the protected amount before reset is known', () => {
    const reserve = normalizeQuotaReserves(routing, {
      accounts: [
        {
          id: 'work.json',
          reserve: {
            policy: 'work-account',
            protected_percent: 0,
            blocked: true,
            reason: 'quota_unknown',
            reset_at: '0001-01-01T00:00:00Z',
          },
        },
      ],
    })['work.json'];
    expect(reserve.status).toBe('unknown');
    expect(reserve.protectedPercent).toBeNull();
    const markup = renderToStaticMarkup(createElement(QuotaReserveDetails, { reserve }));
    expect(markup).toContain('Protected amount unknown');
    expect(markup).not.toContain('0% protected now');
  });

  test('reads native management endpoints and retains the policy if live status cannot be fetched', async () => {
    const get = spyOn(apiClient, 'get').mockImplementation(async (path) => {
      if (path === '/config/routing') return routing;
      if (path === '/credentials/quota-overview') throw Error('offline');
      throw Error('Unexpected endpoint');
    });
    try {
      const reserves = await quotaReservesApi.get();
      expect(reserves['work.json'].status).toBe('unavailable');
      expect(reserves['work.json'].schedule[0].percent).toBe(15);
      expect(get.mock.calls.map(([path]) => path)).toEqual([
        '/config/routing',
        '/credentials/quota-overview',
      ]);
    } finally {
      get.mockRestore();
    }
  });

  test('does not fetch an old connection’s overview after the connection changes', async () => {
    const revision = spyOn(apiClient, 'getConnectionRevision')
      .mockReturnValueOnce(1)
      .mockReturnValue(2);
    const get = spyOn(apiClient, 'get').mockResolvedValue(routing);
    try {
      await expect(quotaReservesApi.get()).rejects.toThrow('Connection changed');
      expect(get).toHaveBeenCalledTimes(1);
    } finally {
      get.mockRestore();
      revision.mockRestore();
    }
  });
});

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test'
);

test('marks only the shared weekly bar, clipping protected shading to the remaining balance', () => {
  const reserve = normalizeQuotaReserves(routing, overview)['work.json'];
  const markup = renderToStaticMarkup(
    createElement(ClaudeQuotaBody, {
      classes,
      reserve,
      quota: {
        status: 'success',
        windows: [
          { id: 'five-hour', label: '5h', usedPercent: 80, resetLabel: '', periodHours: 5 },
          { id: 'seven-day', label: '7d', usedPercent: 80, resetLabel: '', periodHours: 168 },
          {
            id: 'seven-day-fable',
            label: 'Fable',
            usedPercent: 0,
            resetLabel: '',
            periodHours: 168,
          },
        ],
      },
    })
  );
  expect(markup.match(/data-reserve-shading/g)).toHaveLength(1);
  expect(markup).toContain('data-reserve-shading="20"');
  expect(markup).toContain('data-reserve-floor="30"');
  expect(markup).toContain('30% protected now');
});

test('keeps zero reserve visible beneath the weekly bar without shading a fake portion', () => {
  const reserve = {
    ...normalizeQuotaReserves(routing, overview)['work.json'],
    protectedPercent: 0,
    status: 'allowed' as const,
  };
  const markup = renderToStaticMarkup(
    createElement(CodexQuotaBody, {
      classes,
      reserve,
      quota: {
        status: 'success',
        windows: [
          { id: 'weekly', label: '7d', usedPercent: 80, resetLabel: '', periodHours: 168 },
          {
            id: 'code-review-weekly',
            label: 'Review',
            usedPercent: 0,
            resetLabel: '',
            periodHours: 168,
          },
        ],
      },
    })
  );
  expect(markup).toContain('0% protected now');
  expect(markup).not.toContain('data-reserve-shading');
  expect(markup).not.toContain('data-reserve-floor');
  expect(markup.match(/0% protected now/g)).toHaveLength(1);
});

test('keeps policy details visible when the provider response has no shared weekly bar', () => {
  const reserve = normalizeQuotaReserves(routing, overview)['work.json'];
  for (const Body of [ClaudeQuotaBody, CodexQuotaBody]) {
    const markup = renderToStaticMarkup(
      createElement(Body, {
        classes,
        reserve,
        quota: { status: 'success', windows: [] },
      })
    );
    expect(markup).toContain('30% protected now');
    expect(markup).not.toContain('data-reserve-floor');
  }
});
