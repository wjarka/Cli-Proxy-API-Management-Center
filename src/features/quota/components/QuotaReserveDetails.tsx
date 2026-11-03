import { useTranslation } from 'react-i18next';
import type { QuotaReserve } from '@/services/api/quotaReserves';

export function QuotaReserveDetails({
  reserve,
  className,
}: {
  reserve: QuotaReserve;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const deadline =
    reserve.nextReleaseAt &&
    new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      timeZone: reserve.timezone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(reserve.nextReleaseAt));
  return (
    <section
      className={className}
      aria-label={t('quota_reserve.title')}
      data-status={reserve.status}
    >
      <div>
        <strong>
          {reserve.protectedPercent === null
            ? t('quota_reserve.amount_unknown')
            : t('quota_reserve.protected', { percent: reserve.protectedPercent })}
        </strong>
        <span>{reserve.policy}</span>
      </div>
      <p>{t(`quota_reserve.status_${reserve.status}`)}</p>
      {deadline && (
        <p>
          {t('quota_reserve.next_release')}{' '}
          <time dateTime={reserve.nextReleaseAt!}>{deadline}</time>
        </p>
      )}
      <ul aria-label={t('quota_reserve.schedule')}>
        {reserve.schedule.map((entry, index) => (
          <li key={index}>
            <span>{entry.days.map((day) => t(`quota_reserve.days.${day}`)).join(', ')}</span>
            <span>
              {t('quota_reserve.daily', { percent: entry.percent, time: entry.releaseAt })}
            </span>
          </li>
        ))}
      </ul>
      <small>
        {reserve.timezone} · {t('quota_reserve.direct_use')}
      </small>
    </section>
  );
}
