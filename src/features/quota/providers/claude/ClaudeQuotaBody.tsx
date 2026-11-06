// Renders Claude plan, extra usage, and quota windows.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeQuotaState } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { QuotaReserveDetails } from '../../components/QuotaReserveDetails';
import { QuotaUsageDetails } from '../../components/QuotaUsageDetails';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

export function ClaudeQuotaBody({
  quota,
  classes,
  reserve,
  usagePolicy,
}: QuotaBodyProps<ClaudeQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('claude', quota), now),
    [quota, now]
  );
  const windows = quota.windows ?? [];
  const extraUsage = quota.extraUsage ?? null;
  const planType = quota.planType ?? null;

  return (
    <>
      {quota.stale && (
        <div role="status" className={classes.quotaMessage}>
          {t('claude_quota.stale_usage')}
        </div>
      )}
      {planType && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanLabel}>{t('claude_quota.plan_label')}</span>
          <span className={classes.codexPlanValue}>{t(`claude_quota.${planType}`)}</span>
        </div>
      )}
      {extraUsage && extraUsage.is_enabled && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanLabel}>{t('claude_quota.extra_usage_label')}</span>
          <span className={classes.codexPlanValue}>
            {`$${(extraUsage.used_credits / 100).toFixed(2)} / $${(extraUsage.monthly_limit / 100).toFixed(2)}`}
          </span>
        </div>
      )}
      {windows.length === 0 ? (
        <div className={classes.quotaMessage}>{t('claude_quota.empty_windows')}</div>
      ) : (
        windows.map((window, index) => {
          const used = window.usedPercent;
          const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
          const remaining =
            clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
          const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
          const windowLabel = window.labelKey ? t(window.labelKey) : window.label;
          const resetDisplay = buildResetDisplay(
            window.resetLabel,
            window.resetAtMs,
            now,
            i18n.resolvedLanguage
          );

          const soon = window.id === soonestRowId;

          return (
            <div
              key={window.id}
              className={classes.quotaRow}
              title={soon ? t('quota_management.soonest_row_hint') : undefined}
            >
              <div className={classes.quotaRowHeader}>
                <span className={classes.quotaModel}>{windowLabel}</span>
                <div className={classes.quotaMeta}>
                  <span className={classes.quotaPercent}>{percentLabel}</span>
                  {resetDisplay && (
                    <QuotaResetLabel display={resetDisplay} classes={classes} soon={soon} />
                  )}
                </div>
              </div>
              <QuotaMeter
                percent={remaining}
                classes={classes}
                index={index}
                protectedPercent={
                  window.id === 'seven-day'
                    ? reserve?.protectedPercent
                    : window.id === 'five-hour'
                      ? usagePolicy?.protectedPercent
                      : undefined
                }
              />
              {window.id === 'five-hour' && usagePolicy && (
                <QuotaUsageDetails
                  usagePolicy={usagePolicy}
                  className={classes.quotaReserveDetails}
                />
              )}
              {window.id === 'seven-day' && reserve && (
                <QuotaReserveDetails reserve={reserve} className={classes.quotaReserveDetails} />
              )}
            </div>
          );
        })
      )}
      {reserve && !windows.some((window) => window.id === 'seven-day') && (
        <QuotaReserveDetails reserve={reserve} className={classes.quotaReserveDetails} />
      )}
      {usagePolicy && !windows.some((window) => window.id === 'five-hour') && (
        <QuotaUsageDetails usagePolicy={usagePolicy} className={classes.quotaReserveDetails} />
      )}
    </>
  );
}
