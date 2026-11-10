import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { IconRefreshCw } from '@/components/ui/icons';
import { getAuthFileIcon } from '@/features/authFiles/constants';
import { grantExpiry } from '@/features/billing/logic';
import { useNow } from '@/hooks/useNow';
import { billingErrorKey } from '@/services/api/billing';
import type { ResolvedTheme } from '@/types';
import { formatRelativeInstant } from '@/utils/quota/relativeTime';
import { consoleQuotaStatus, type ConsoleQuotaEntry } from '../consoleQuota';
import cardStyles from './QuotaCard.module.scss';
import styles from './ConsoleQuotaCard.module.scss';

export type ConsoleQuotaCardProps = {
  entry: ConsoleQuotaEntry;
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  refreshing: boolean;
  errorKey?: string;
  onRefresh: () => void;
  now?: number;
};

export function ConsoleQuotaCard({
  entry,
  resolvedTheme,
  canRefresh,
  refreshing,
  errorKey,
  onRefresh,
  now,
}: ConsoleQuotaCardProps) {
  const { t, i18n } = useTranslation();
  const clock = useNow(now === undefined);
  const instant = now ?? clock;
  const { account, connection, credentials } = entry;
  const status = consoleQuotaStatus(entry, instant);
  const reconnect = status === 'reconnect_required';
  const provider =
    entry.type === 'openai' ? t('auth_files.filter_openai') : t('billing.provider_claude');
  const icon = getAuthFileIcon(entry.type === 'openai' ? 'codex' : entry.type, resolvedTheme);
  const hasUnverified = credentials.some(
    (credential) => credential.verificationStatus !== 'verified'
  );
  const message = errorKey
    ? t(
        errorKey.startsWith('billing.') && i18n.exists(errorKey)
          ? errorKey
          : 'console_quota.refresh_failed'
      )
    : account.error || connection?.error
      ? t(billingErrorKey(account.error ?? connection?.error))
      : null;
  const money = (value: number | null) => {
    if (value === null || !Number.isFinite(value)) return t('billing.unknown');
    try {
      return new Intl.NumberFormat(i18n.language, {
        style: 'currency',
        currency: account.currency,
      }).format(value);
    } catch {
      return t('billing.unknown');
    }
  };
  const time = (value: string | null) => {
    if (!value || !Number.isFinite(Date.parse(value))) return t('billing.unknown');
    return (
      <span className={styles.time}>
        <time dateTime={value}>{new Date(value).toLocaleString(i18n.language)}</time>
        <span className={styles.muted}>
          {formatRelativeInstant(Date.parse(value), instant, i18n.language)}
        </span>
      </span>
    );
  };

  return (
    <article className={`${cardStyles.card} ${styles.consoleCard}`}>
      <header className={cardStyles.head}>
        <span className={cardStyles.iconWrap} title={provider}>
          {icon && <img src={icon} alt="" className={cardStyles.icon} />}
        </span>
        <span className={styles.heading}>
          <span className={cardStyles.fileName} title={account.name || account.organizationId}>
            {account.name || account.organizationId}
          </span>
          <span className={styles.provider}>{provider}</span>
        </span>
        <span className={styles.badge}>{t('console_quota.badge')}</span>
      </header>

      <div className={cardStyles.body}>
        <p className={styles.organization}>
          {t('console_quota.organization')}: {account.organizationId}
        </p>
        <div className={styles.balanceRow}>
          <div>
            <span className={styles.label}>
              {t('billing.balance')} · {account.currency}
            </span>
            <strong className={styles.balance}>{money(account.balance)}</strong>
          </div>
          <span className={status === 'ready' ? styles.status : styles.attention}>
            {t(`billing.status_${status}`)}
          </span>
        </div>
        <p className={styles.hint}>{t('console_quota.shared_pool')}</p>
        <div className={styles.observed}>
          <span className={styles.label}>{t('billing.observed')}</span>
          {time(account.observedAt)}
        </div>
        {status !== 'ready' && <p className={styles.hint}>{t('billing.stale_hint')}</p>}
        {message && (
          <p role="alert" className={cardStyles.errorStrip}>
            {message}
          </p>
        )}

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t('billing.grants')}</h3>
          {account.grants.length === 0 ? (
            <p className={styles.hint}>{t('billing.no_grants')}</p>
          ) : (
            <ul className={styles.grantList}>
              {account.grants.map((grant, index) => {
                const expiry = grantExpiry(grant.expiresAt, instant);
                return (
                  <li key={grant.id || index} className={styles.grant}>
                    <strong className={styles.grantName}>
                      {grant.name || grant.kind || t('billing.grant')}
                    </strong>
                    <dl className={styles.amounts}>
                      <div>
                        <dt>{t('billing.granted')}</dt>
                        <dd>{money(grant.amount)}</dd>
                      </div>
                      <div>
                        <dt>{t('billing.remaining')}</dt>
                        <dd>{money(grant.remaining)}</dd>
                      </div>
                    </dl>
                    <div className={styles.expiry}>
                      <span className={styles.label}>{t('billing.expires')}</span>
                      {grant.expiresAt && time(grant.expiresAt)}
                      <span
                        className={
                          expiry === 'expired' || expiry === 'expiring'
                            ? styles.attention
                            : styles.muted
                        }
                      >
                        {t(`billing.expiry_${expiry}`)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t('console_quota.linked_credentials')}</h3>
          {credentials.length === 0 ? (
            <p className={styles.hint}>{t('console_quota.no_credentials')}</p>
          ) : (
            <ul className={styles.credentialList}>
              {credentials.map((credential) => (
                <li key={credential.id} className={styles.credential}>
                  <span className={styles.credentialLabel}>
                    {credential.label || t('billing.unknown')}
                  </span>
                  <span
                    className={
                      credential.verificationStatus === 'verified' ? styles.muted : styles.attention
                    }
                  >
                    {t(
                      credential.verificationStatus === 'verified'
                        ? 'billing.verified'
                        : 'billing.unverified'
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {hasUnverified && <p className={styles.hint}>{t('console_quota.unverified_hint')}</p>}
        </section>
      </div>

      <footer className={`${cardStyles.actionRow} ${styles.footer}`}>
        <Link to="/billing" className={`${cardStyles.actionPill} ${styles.link}`}>
          {t(reconnect ? 'console_quota.reconnect' : 'console_quota.manage')}
        </Link>
        <button
          type="button"
          className={cardStyles.actionPill}
          onClick={onRefresh}
          disabled={!canRefresh || refreshing || !connection || reconnect}
          aria-busy={refreshing}
        >
          <IconRefreshCw
            size={13}
            aria-hidden="true"
            className={refreshing ? cardStyles.spinning : undefined}
          />
          {t('billing.refresh')}
        </button>
      </footer>
    </article>
  );
}
