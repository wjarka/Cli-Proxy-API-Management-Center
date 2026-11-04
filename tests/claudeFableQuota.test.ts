import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { buildClaudeQuotaWindows } from '@/features/quota/providers/claude/data';
import type { ClaudeUsagePayload } from '@/types';
import { formatQuotaResetTime } from '@/utils/quota';

const t = ((key: string) => key) as TFunction;
const modernReset = '2026-07-27T10:00:00.000000+00:00';
const legacyReset = '2026-07-28T10:00:00.000000+00:00';

describe('Claude Fable quota', () => {
  test('builds a Fable window from the modern scoped limits payload', () => {
    const windows = buildClaudeQuotaWindows(
      {
        limits: [
          {
            kind: 'weekly_scoped',
            group: 'weekly',
            percent: 64,
            resets_at: modernReset,
            is_active: true,
            scope: { model: { id: null, display_name: 'Fable' } },
          },
        ],
      },
      t
    );

    expect(windows).toEqual([
      {
        id: 'seven-day-fable',
        label: 'claude_quota.seven_day_fable',
        labelKey: 'claude_quota.seven_day_fable',
        usedPercent: 64,
        resetLabel: formatQuotaResetTime(modernReset),
        resetAtMs: Date.parse(modernReset),
        periodHours: 24 * 7,
      },
    ]);
  });

  test('shows a dollar-denominated legacy field as cloud session credits, not Fable', () => {
    const reset = '2026-11-05T07:59:00+00:00';
    const windows = buildClaudeQuotaWindows(
      {
        iguana_necktie: {
          utilization: 5.043595,
          resets_at: reset,
          limit_dollars: 100,
          used_dollars: 5.043595,
          remaining_dollars: 94.956405,
        },
        limits: [
          { kind: 'session', percent: 10, resets_at: modernReset, is_active: true, scope: null },
          { kind: 'weekly_all', percent: 9, resets_at: legacyReset, is_active: false, scope: null },
        ],
      },
      t
    );

    expect(windows).toEqual([
      {
        id: 'cloud-session-credits',
        label: 'claude_quota.cloud_session_credits',
        labelKey: 'claude_quota.cloud_session_credits',
        usedPercent: 5.043595,
        resetLabel: formatQuotaResetTime(reset),
        resetAtMs: Date.parse(reset),
        periodHours: null,
      },
    ]);
  });

  test('shows both cloud session credits and the scoped Fable limit', () => {
    const windows = buildClaudeQuotaWindows(
      {
        iguana_necktie: {
          utilization: 5,
          resets_at: '2026-11-05T07:59:00+00:00',
          limit_dollars: 100,
          used_dollars: 5,
        },
        limits: [
          {
            kind: 'weekly_scoped',
            percent: 64,
            resets_at: modernReset,
            is_active: true,
            scope: { model: { id: null, display_name: 'Fable' } },
          },
        ],
      },
      t
    );

    expect(windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ['cloud-session-credits', 5],
      ['seven-day-fable', 64],
    ]);
  });

  test('treats a legacy field with only remaining_dollars as cloud session credits', () => {
    const windows = buildClaudeQuotaWindows(
      {
        iguana_necktie: {
          utilization: 5,
          resets_at: '2026-11-05T07:59:00+00:00',
          remaining_dollars: 95,
        },
        limits: [
          {
            kind: 'weekly_scoped',
            percent: 64,
            resets_at: modernReset,
            is_active: true,
            scope: { model: { id: null, display_name: 'Fable' } },
          },
        ],
      },
      t
    );

    expect(windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ['cloud-session-credits', 5],
      ['seven-day-fable', 64],
    ]);
  });

  test('falls back to the legacy Fable field', () => {
    const windows = buildClaudeQuotaWindows(
      {
        iguana_necktie: {
          utilization: 41,
          resets_at: legacyReset,
        },
      },
      t
    );

    expect(windows).toEqual([
      {
        id: 'seven-day-fable',
        label: 'claude_quota.seven_day_fable',
        labelKey: 'claude_quota.seven_day_fable',
        usedPercent: 41,
        resetLabel: formatQuotaResetTime(legacyReset),
        resetAtMs: Date.parse(legacyReset),
        periodHours: 24 * 7,
      },
    ]);
  });

  test('falls back to the legacy field when the modern percent is invalid', () => {
    const windows = buildClaudeQuotaWindows(
      {
        iguana_necktie: {
          utilization: 41,
          resets_at: legacyReset,
        },
        limits: [
          {
            kind: 'weekly_scoped',
            percent: null,
            resets_at: modernReset,
            is_active: true,
            scope: { model: { display_name: 'Fable' } },
          },
        ],
      },
      t
    );

    expect(windows).toEqual([
      {
        id: 'seven-day-fable',
        label: 'claude_quota.seven_day_fable',
        labelKey: 'claude_quota.seven_day_fable',
        usedPercent: 41,
        resetLabel: formatQuotaResetTime(legacyReset),
        resetAtMs: Date.parse(legacyReset),
        periodHours: 24 * 7,
      },
    ]);
  });

  test('prefers the active modern field without rendering a duplicate', () => {
    const windows = buildClaudeQuotaWindows(
      {
        iguana_necktie: {
          utilization: 41,
          resets_at: legacyReset,
        },
        limits: [
          {
            kind: 'weekly_scoped',
            percent: 12,
            resets_at: legacyReset,
            is_active: false,
            scope: { model: { display_name: 'Fable 5' } },
          },
          {
            kind: 'weekly_scoped',
            percent: 64,
            resets_at: modernReset,
            is_active: true,
            scope: { model: { display_name: 'Fable' } },
          },
        ],
      },
      t
    );

    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({
      id: 'seven-day-fable',
      usedPercent: 64,
      resetLabel: formatQuotaResetTime(modernReset),
    });
  });

  test('uses a valid modern candidate when the preferred candidate is invalid', () => {
    const windows = buildClaudeQuotaWindows(
      {
        limits: [
          {
            kind: 'weekly_scoped',
            percent: null,
            resets_at: legacyReset,
            is_active: true,
            scope: { model: { display_name: 'Fable' } },
          },
          {
            kind: 'weekly_scoped',
            percent: 64,
            resets_at: modernReset,
            is_active: false,
            scope: { model: { display_name: 'Fable' } },
          },
        ],
      },
      t
    );

    expect(windows).toEqual([
      {
        id: 'seven-day-fable',
        label: 'claude_quota.seven_day_fable',
        labelKey: 'claude_quota.seven_day_fable',
        usedPercent: 64,
        resetLabel: formatQuotaResetTime(modernReset),
        resetAtMs: Date.parse(modernReset),
        periodHours: 24 * 7,
      },
    ]);
  });

  test('ignores malformed and unrelated limits while preserving standard windows', () => {
    const payload = {
      five_hour: { utilization: 10, resets_at: null },
      seven_day: { utilization: 20, resets_at: legacyReset },
      limits: [
        null,
        { kind: 'weekly_scoped', percent: 35, scope: { model: { display_name: 'Sonnet' } } },
        { kind: 'session', percent: 50, scope: { model: { display_name: 'Fable' } } },
        { kind: 'weekly_scoped', percent: null, scope: { model: { display_name: 'Fable' } } },
      ],
    } as unknown as ClaudeUsagePayload;

    const windows = buildClaudeQuotaWindows(payload, t);

    expect(windows.map(({ id, usedPercent }) => ({ id, usedPercent }))).toEqual([
      { id: 'five-hour', usedPercent: 10 },
      { id: 'seven-day', usedPercent: 20 },
    ]);
  });
});

test('Claude quota retains prior windows and marks a cached 429 reading stale', async () => {
  const { spyOn } = await import('bun:test');
  const { apiCallApi } = await import('@/services/api/apiCall');
  const { CLAUDE_CONFIG } = await import('@/features/quota/providers/claude/data');
  const request = spyOn(apiCallApi, 'request').mockImplementation(async (input) => {
    const isUsage = input.url.endsWith('/usage');
    const body = isUsage ? { seven_day: { utilization: 80, resets_at: modernReset } } : {};
    return {
      statusCode: 200,
      header: {},
      body,
      bodyText: JSON.stringify(body),
      usageStale: isUsage,
    };
  });
  try {
    const data = await CLAUDE_CONFIG.fetchQuota({ name: 'work.json', auth_index: 'test' }, t);
    const quota = CLAUDE_CONFIG.buildSuccessState(data);
    expect(request.mock.calls.some(([input]) => input.cacheClaudeUsage === true)).toBe(true);
    expect(quota).toMatchObject({
      status: 'success',
      stale: true,
      windows: [{ id: 'seven-day', usedPercent: 80 }],
    });
  } finally {
    request.mockRestore();
  }
});
