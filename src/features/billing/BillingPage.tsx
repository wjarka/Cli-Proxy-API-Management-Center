import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  billingApi,
  billingErrorKey,
  type BillingConnection,
  type BillingCredential,
  type BillingBinding,
  type BillingAccount,
  type BillingProvider,
  type BillingSnapshot,
} from '@/services/api/billing';
import { apiClient } from '@/services/api/client';
import { useAuthStore } from '@/stores';
import { BillingBrowserLogin } from './BillingBrowserLogin';
import { BillingAccounts } from './BillingAccounts';
import { buildLoginCommand, createBillingRequestGuard } from './logic';
import styles from './BillingPage.module.scss';

function CredentialRow({
  credential,
  binding,
  accounts,
  busy,
  run,
}: {
  credential: BillingCredential;
  binding?: BillingBinding;
  accounts: BillingAccount[];
  busy: boolean;
  run: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [accountId, setAccountId] = useState(binding?.accountId ?? '');
  const choices = accounts.filter((account) => account.provider === credential.provider);
  return (
    <div className={styles.credential}>
      <div>
        <strong>{credential.label || credential.id}</strong>
        <p>
          {t(`billing.provider_${credential.provider}`)} ·{' '}
          {binding
            ? t(binding.verified ? 'billing.verified' : 'billing.unverified')
            : t('billing.unlinked')}
        </p>
      </div>
      <Select
        value={accountId}
        options={choices.map((account) => ({
          value: account.id,
          label: `${account.name || account.organizationId} · ${account.organizationId}`,
        }))}
        onChange={setAccountId}
        ariaLabel={t('billing.account_for', { credential: credential.label || credential.id })}
        placeholder={t('billing.choose_account')}
        disabled={busy}
      />
      <div className={styles.actions}>
        <Button
          size="sm"
          disabled={busy || !accountId || accountId === binding?.accountId}
          onClick={() => run(() => billingApi.bind(credential.id, accountId))}
        >
          {t('billing.link')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => run(() => billingApi.verify(credential.id))}
        >
          {t('billing.verify')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !binding}
          onClick={() => run(() => billingApi.unbind(credential.id))}
        >
          {t('billing.unlink')}
        </Button>
      </div>
    </div>
  );
}

/** A fresh component is mounted for every management connection revision and logout. */
export function BillingPage() {
  const auth = useAuthStore();
  const revision = apiClient.getConnectionRevision();
  return (
    <BillingSession
      key={`${revision}:${auth.connectionStatus}`}
      apiBase={auth.apiBase}
      connected={auth.connectionStatus === 'connected'}
    />
  );
}

function BillingSession({ apiBase, connected }: { apiBase: string; connected: boolean }) {
  const { t } = useTranslation();
  const [data, setData] = useState<BillingSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [target, setTarget] = useState<BillingConnection | null>(null);
  const [provider, setProvider] = useState<BillingProvider>('claude');
  const [label, setLabel] = useState('');
  const [session, setSession] = useState('');
  const mounted = useRef(false);
  const loadSequence = useRef(0);
  const requestGuard = useRef(createBillingRequestGuard(() => apiClient.getConnectionRevision()));
  const current = useCallback(() => mounted.current && requestGuard.current(), []);
  const load = useCallback(async () => {
    if (!connected || !current()) return;
    const sequence = ++loadSequence.current;
    const latest = () => current() && sequence === loadSequence.current;
    setLoading(true);
    try {
      const snapshot = await billingApi.list();
      if (latest()) {
        setData(snapshot);
        setError('');
      }
    } catch (error: unknown) {
      if (latest()) setError(billingErrorKey(error, 'billing.load_failed'));
    } finally {
      if (latest()) setLoading(false);
    }
  }, [connected, current]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  useHeaderRefresh(load);

  const run = async (operation: () => Promise<unknown>) => {
    if (!connected || !current() || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    let failure = '';
    try {
      await operation();
    } catch (error: unknown) {
      failure = billingErrorKey(error);
    }
    if (!current()) return;
    await load();
    if (!current()) return;
    if (failure) setError(failure);
    setBusy(false);
  };
  const closeImport = () => {
    setSession('');
    setEditing(false);
    setTarget(null);
    setLabel('');
  };
  const openImport = (connection: BillingConnection | null) => {
    setEditorRevision((value) => value + 1);
    setSession('');
    setTarget(connection);
    setProvider(connection?.provider ?? 'claude');
    setLabel(connection?.label ?? '');
    setEditing(true);
    setNotice('');
  };
  const command = buildLoginCommand(provider, apiBase, target?.id);
  const downloadHelper = async () => {
    if (!current() || busy) return;
    setBusy(true);
    setError('');
    try {
      const source = await billingApi.loginHelper();
      if (!current()) return;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/x-python' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'console-login.py';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (current()) setError('billing.action_failed');
    } finally {
      if (current()) setBusy(false);
    }
  };
  const copyCommand = async () => {
    try {
      await navigator.clipboard.writeText(command);
      if (current()) setNotice('billing.copied');
    } catch {
      if (current()) setError('billing.copy_failed');
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.heading}>
        <div>
          <h1>{t('billing.title')}</h1>
          <p>{t('billing.subtitle')}</p>
        </div>
        <Button
          variant="secondary"
          disabled={loading || busy || !connected}
          onClick={() => void load()}
        >
          {t('billing.reload')}
        </Button>
      </div>
      {error && (
        <div className="error-box" role="alert">
          {t(error)}
        </div>
      )}
      {notice && <p role="status">{t(notice)}</p>}
      {!connected ? (
        <p>{t('notification.connection_required')}</p>
      ) : (
        <>
          <Card
            title={t('billing.connections')}
            extra={
              <Button disabled={busy} onClick={() => openImport(null)}>
                {t('billing.connect')}
              </Button>
            }
          >
            <p>{t('billing.connections_hint')}</p>
            {loading && !data && <p role="status">{t('billing.loading')}</p>}
            {data?.connections.length === 0 && <p>{t('billing.no_connections')}</p>}
            {data?.connections.map((connection) => (
              <div className={styles.connection} key={connection.id}>
                <div>
                  <strong>
                    {connection.label || t(`billing.provider_${connection.provider}`)}
                  </strong>
                  <p>
                    {t(`billing.provider_${connection.provider}`)} ·{' '}
                    {t(`billing.connection_${connection.status}`)} ·{' '}
                    {t('billing.organization_count', { count: connection.accountIds.length })}
                  </p>
                  {connection.error && <p>{t(billingErrorKey(connection.error))}</p>}
                </div>
                <div className={styles.actions}>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => openImport(connection)}
                  >
                    {t('billing.reconnect')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || connection.status === 'reconnect_required'}
                    onClick={() => run(() => billingApi.refresh(connection.id))}
                  >
                    {t('billing.refresh')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy}
                    onClick={() => run(() => billingApi.disconnect(connection.id))}
                  >
                    {t('billing.disconnect')}
                  </Button>
                </div>
              </div>
            ))}
          </Card>
          {editing && (
            <Card title={t(target ? 'billing.reconnect' : 'billing.connect')}>
              <div className={styles.form}>
                <Select
                  value={provider}
                  options={[
                    { value: 'claude', label: t('billing.provider_claude') },
                    { value: 'openai', label: t('billing.provider_openai') },
                  ]}
                  onChange={(value) => {
                    setProvider(value as BillingProvider);
                    setSession('');
                  }}
                  ariaLabel={t('billing.provider')}
                  disabled={busy || Boolean(target)}
                />
                {!target && (
                  <Input
                    label={t('billing.label')}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    autoComplete="off"
                    disabled={busy}
                  />
                )}
                <BillingBrowserLogin
                  key={`${editorRevision}:${provider}:${target?.id ?? 'new'}`}
                  request={{ provider, label: label.trim(), connectionId: target?.id }}
                  apiBase={apiBase}
                  current={current}
                  onSuccess={async () => {
                    closeImport();
                    await load();
                  }}
                />
                <details>
                  <summary>{t('billing.browser_alternative')}</summary>
                  <h3>{t('billing.local_login')}</h3>
                  <p>{t('billing.helper_hint')}</p>
                  <div className={styles.actions}>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => void downloadHelper()}
                    >
                      {t('billing.download_helper')}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => void copyCommand()}>
                      {t('billing.copy_command')}
                    </Button>
                  </div>
                  <pre className={styles.command}>
                    <code>{command}</code>
                  </pre>
                  <p>{t('billing.helper_key_hint')}</p>
                  <details>
                    <summary>{t('billing.manual_import')}</summary>
                    <p>
                      {t(
                        provider === 'claude'
                          ? 'billing.claude_session_hint'
                          : 'billing.openai_session_hint'
                      )}
                    </p>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!session.trim() || busy) return;
                        const imported = session.trim();
                        setSession('');
                        void run(async () => {
                          if (target) await billingApi.reconnect(target.id, imported);
                          else await billingApi.connect(provider, label.trim(), imported);
                          if (current()) closeImport();
                        });
                      }}
                    >
                      <Input
                        label={t('billing.session')}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={session}
                        onChange={(event) => setSession(event.target.value)}
                        disabled={busy}
                      />
                      <Button type="submit" disabled={busy || !session.trim()}>
                        {t('billing.import_session')}
                      </Button>
                    </form>
                  </details>
                </details>
                <div className={styles.actions}>
                  <Button variant="ghost" disabled={busy} onClick={closeImport}>
                    {t('common.close')}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void load()}>
                    {t('billing.reload_after_login')}
                  </Button>
                </div>
              </div>
            </Card>
          )}
          <section aria-label={t('billing.accounts')}>
            <h2>{t('billing.accounts')}</h2>
            <div className={styles.accounts}>
              <BillingAccounts accounts={data?.accounts ?? []} />
            </div>
          </section>
          <Card title={t('billing.credentials')}>
            <p>{t('billing.bindings_hint')}</p>
            {data?.credentials.length === 0 && <p>{t('billing.no_credentials')}</p>}
            {data?.credentials.map((credential) => {
              const binding = data.bindings.find((entry) => entry.credentialId === credential.id);
              return (
                <CredentialRow
                  key={`${credential.id}:${binding?.accountId}:${binding?.verified}`}
                  credential={credential}
                  binding={binding}
                  accounts={data.accounts}
                  busy={busy}
                  run={run}
                />
              );
            })}
          </Card>
        </>
      )}
    </div>
  );
}
