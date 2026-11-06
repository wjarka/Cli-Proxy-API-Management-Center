import { useTranslation } from 'react-i18next';
import type { QuotaUsagePolicy } from '@/services/api/quotaUsagePolicies';

export function QuotaUsageDetails({
  usagePolicy,
  className,
  compact = true,
}: {
  usagePolicy: QuotaUsagePolicy;
  className?: string;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const amount =
    usagePolicy.protectedPercent === null
      ? t('quota_reserve.amount_unknown')
      : t('quota_reserve.protected', { percent: usagePolicy.protectedPercent });
  const deadline =
    usagePolicy.activeUntil &&
    new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      timeZone: usagePolicy.timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(usagePolicy.activeUntil));
  const summary = (
    <>
      <strong>
        {t('quota_usage.title')} · {amount}
      </strong>
      <span> · {t(`quota_usage.status_${usagePolicy.status}`)}</span>
    </>
  );
  if (compact)
    return (
      <p className={className} aria-label={t('quota_usage.title')} data-status={usagePolicy.status}>
        {summary}
      </p>
    );
  return (
    <section
      className={className}
      aria-label={t('quota_usage.title')}
      data-status={usagePolicy.status}
    >
      <div>{summary}</div>
      <p>
        {usagePolicy.policy} ·{' '}
        {t('quota_usage.configured', { percent: usagePolicy.configuredPercent })}
      </p>
      {deadline && (
        <p>
          {t('quota_usage.active_until')}{' '}
          <time dateTime={usagePolicy.activeUntil!}>{deadline}</time>
        </p>
      )}
      <ul aria-label={t('quota_usage.schedule')}>
        {usagePolicy.schedule.map((entry, index) => (
          <li key={index}>
            <span>{entry.days.map((day) => t(`quota_reserve.days.${day}`)).join(', ')}</span>{' '}
            <span>
              {entry.start}–{entry.end}
            </span>
          </li>
        ))}
      </ul>
      <small>
        {usagePolicy.timezone} · {t('quota_reserve.direct_use')}
      </small>
    </section>
  );
}
