import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { Card } from '@/components/ui/Card';
import { billingErrorKey, type BillingAccount } from '@/services/api/billing';
import { billingAccountStatus, grantExpiry } from './logic';

export function BillingAccounts({ accounts, now }: { accounts: BillingAccount[]; now?: number }) {
  const { t, i18n } = useTranslation();
  const clock = useNow();
  const money = (value: number | null, currency: string) => {
    if (value === null) return t('billing.unknown');
    try {
      return new Intl.NumberFormat(i18n.language, { style: 'currency', currency }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  };
  const instant = (value: string) => new Date(value).toLocaleString(i18n.language);
  return (
    <>
      {accounts.length === 0 && <p>{t('billing.no_accounts')}</p>}
      {accounts.map((account) => (
        <Card key={account.id} title={account.name || account.organizationId}>
          <p>
            {t(`billing.provider_${account.provider}`)} · {account.organizationId}
          </p>
          <p>
            <strong>
              {t('billing.balance')}: {money(account.balance, account.currency)}
            </strong>{' '}
            · <span>{t(`billing.status_${billingAccountStatus(account, now ?? clock)}`)}</span>
          </p>
          <p>
            {t('billing.observed')}:{' '}
            {account.observedAt ? instant(account.observedAt) : t('billing.unknown')}
          </p>
          {billingAccountStatus(account, now ?? clock) !== 'ready' && (
            <p>{t('billing.stale_hint')}</p>
          )}
          {account.error && <p>{t(billingErrorKey(account.error))}</p>}
          <h3>{t('billing.grants')}</h3>
          {account.grants.length === 0 ? (
            <p>{t('billing.no_grants')}</p>
          ) : (
            <ul>
              {account.grants.map((grant, index) => (
                <li key={grant.id || index}>
                  <strong>{grant.name || grant.kind || t('billing.grant')}</strong>
                  <p>
                    {t('billing.granted')}: {money(grant.amount, account.currency)} ·{' '}
                    {t('billing.remaining')}: {money(grant.remaining, account.currency)}
                  </p>
                  <p>
                    {t('billing.expires')}:{' '}
                    {grant.expiresAt ? instant(grant.expiresAt) : t('billing.unknown')} ·{' '}
                    {t(`billing.expiry_${grantExpiry(grant.expiresAt, now ?? clock)}`)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </>
  );
}
