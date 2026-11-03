import { describe, expect, test } from 'bun:test';
import { resolveClaudePlanType } from '@/features/quota/providers/claude/data';
import type { ClaudeProfileResponse } from '@/types';
import en from '@/i18n/locales/en.json';
import ru from '@/i18n/locales/ru.json';
import vi from '@/i18n/locales/vi.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';

describe('Claude plan type', () => {
  test.each([
    ['default_claude_max_20x', 'plan_ultra', 'Ultra'],
    ['default_claude_max_5x', 'plan_max', 'Max'],
    [' DEFAULT_CLAUDE_MAX_20X ', 'plan_ultra', 'Ultra'],
    ['unknown-tier', 'plan_max', 'Max'],
    [undefined, 'plan_max', 'Max'],
  ] as const)('labels the personal tier %s using current plan names', (tier, expected, label) => {
    const plan = resolveClaudePlanType({
      account: { has_claude_max: true, has_claude_pro: true },
      organization: {
        organization_type: 'claude_max',
        subscription_status: 'active',
        rate_limit_tier: tier,
      },
    });

    expect(plan).toBe(expected);
    for (const locale of [en, ru, vi, zhCN, zhTW]) {
      expect(locale.claude_quota[plan as keyof typeof locale.claude_quota]).toBe(label);
    }
  });

  test('does not label an active Team token as the personal Ultra plan', () => {
    expect(
      resolveClaudePlanType({
        account: { has_claude_max: true },
        organization: {
          organization_type: 'claude_team',
          subscription_status: 'active',
          rate_limit_tier: 'default_claude_max_20x',
        },
      })
    ).toBe('plan_team');
  });

  test.each([
    { has_claude_max: false, has_claude_pro: true },
    { has_claude_max: true, has_claude_pro: false },
    { has_claude_max: true, has_claude_pro: true },
    { has_claude_max: false, has_claude_pro: false },
    {},
  ])('prefers the active Team organization over account flags %j', (account) => {
    expect(
      resolveClaudePlanType({
        account,
        organization: { organization_type: 'claude_team', subscription_status: 'active' },
      })
    ).toBe('plan_team');
  });

  test.each([
    [{ has_claude_max: false, has_claude_pro: true }, 'plan_pro'],
    [{ has_claude_max: true, has_claude_pro: true }, 'plan_max'],
    [{ has_claude_max: false, has_claude_pro: false }, 'plan_free'],
    [{}, null],
  ] as const)('preserves personal plan detection for %j', (account, expected) => {
    expect(
      resolveClaudePlanType({
        account,
        organization: { organization_type: 'claude_pro', subscription_status: 'active' },
      })
    ).toBe(expected);
    expect(resolveClaudePlanType({ account })).toBe(expected);
  });

  test.each(['inactive', 'canceled', undefined])(
    'does not label a Team organization with status %s as active Team',
    (subscriptionStatus) => {
      expect(
        resolveClaudePlanType({
          account: { has_claude_pro: true },
          organization: {
            organization_type: 'claude_team',
            subscription_status: subscriptionStatus,
          },
        })
      ).toBe('plan_pro');
    }
  );

  test('preserves case-insensitive organization matching', () => {
    expect(
      resolveClaudePlanType({
        account: { has_claude_pro: true },
        organization: { organization_type: 'CLAUDE_TEAM', subscription_status: 'ACTIVE' },
      })
    ).toBe('plan_team');
  });

  test.each([
    null,
    {},
    { account: { has_claude_max: false } },
  ] satisfies (ClaudeProfileResponse | null)[])(
    'returns unknown for an incomplete profile %j',
    (profile) => {
      expect(resolveClaudePlanType(profile)).toBeNull();
    }
  );
});
