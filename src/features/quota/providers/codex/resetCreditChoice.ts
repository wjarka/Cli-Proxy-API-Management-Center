import type { TFunction } from 'i18next';
import type { CodexQuotaState } from '@/types';
import { listSelectableCodexCredits, resolveResetMs } from '@/utils/quota';
import { formatDateTimeValue } from '@/utils/format';

export function getCodexResetChoice(quota: CodexQuotaState | undefined, t: TFunction) {
  const credits = quota?.status === 'success' ? (quota.rateLimitResetCredits ?? []) : [];
  const options = listSelectableCodexCredits(credits, Date.now()).map((credit) => {
    const index = credits.indexOf(credit);
    const expires = resolveResetMs([credit.expiresAt]);
    return {
      id: credit.id,
      label: credit.title || t('codex_quota.reset_credit_number', { index: index + 1 }),
      details: [
        ...(credit.description ? [credit.description] : []),
        expires === null
          ? t('claude_reset.expiry_unknown')
          : t('claude_reset.ends', { date: formatDateTimeValue(expires) }),
      ],
    };
  });
  return { label: t('quota_reset.choose'), options };
}
