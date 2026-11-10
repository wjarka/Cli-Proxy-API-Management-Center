import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type RFB from '@novnc/novnc';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  billingErrorKey,
  createBillingBrowserApi,
  type BillingBrowserSession,
  type BillingBrowserRequest,
} from '@/services/api/billing';
import { browserViewerUrl, createBrowserLoginFlow } from './logic';
import styles from './BillingPage.module.scss';

function BrowserViewer({
  session,
  api,
  apiBase,
  current,
}: {
  session: BillingBrowserSession;
  api: ReturnType<typeof createBillingBrowserApi>;
  apiBase: string;
  current: () => boolean;
}) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<RFB | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState('billing.browser_connecting');
  const [keyboard, setKeyboard] = useState(false);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    let active = true;
    let rfb: RFB | undefined;
    setStatus('billing.browser_connecting');
    const open = async () => {
      try {
        const [{ default: RFB }, ticket] = await Promise.all([
          import('./browserRfb'),
          api.ticket(session.id),
        ]);
        if (!active || !current() || !host.current) return;
        rfb = new RFB(host.current, browserViewerUrl(apiBase, session.id), {
          wsProtocols: ['binary', `cliproxy-ticket.${ticket}`],
        });
        viewer.current = rfb;
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.focusOnClick = true;
        rfb.addEventListener('connect', () => {
          if (active && current()) setStatus('billing.browser_connected');
        });
        rfb.addEventListener('disconnect', () => {
          if (active && current()) setStatus('billing.browser_view_disconnected');
        });
        rfb.addEventListener('securityfailure', () => {
          if (active && current()) setStatus('billing.browser_view_disconnected');
        });
      } catch (error) {
        if (active && current())
          setStatus(billingErrorKey(error, 'billing.browser_view_disconnected'));
      }
    };
    void open();
    return () => {
      active = false;
      viewer.current = null;
      rfb?.disconnect();
    };
  }, [session.id, api, apiBase, current, attempt]);
  const sendKey = (keysym: number) => viewer.current?.sendKey(keysym);
  return (
    <div className={styles.browserPanel}>
      <p role="status">{t(status)}</p>
      <div
        className={styles.browserViewport}
        ref={host}
        role="group"
        aria-label={t('billing.browser_viewer')}
      />
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => viewer.current?.focus()}>
          {t('billing.browser_focus')}
        </Button>
        <Button variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
          {t('billing.browser_retry_view')}
        </Button>
        <Button variant="secondary" aria-expanded={keyboard} onClick={() => setKeyboard(!keyboard)}>
          {t('billing.browser_keyboard')}
        </Button>
      </div>
      {keyboard && (
        <div className={styles.form}>
          <Input
            type="password"
            label={t('billing.browser_type_text')}
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={!typed || status !== 'billing.browser_connected'}
              onClick={() => {
                for (const char of typed) {
                  const point = char.codePointAt(0)!;
                  sendKey(point <= 255 ? point : 0x01000000 | point);
                }
                setTyped('');
              }}
            >
              {t('billing.browser_send_text')}
            </Button>
            <Button variant="secondary" onClick={() => sendKey(0xff09)}>
              {t('billing.browser_tab')}
            </Button>
            <Button variant="secondary" onClick={() => sendKey(0xff0d)}>
              {t('billing.browser_enter')}
            </Button>
            <Button
              variant="secondary"
              aria-label={t('billing.browser_backspace')}
              onClick={() => sendKey(0xff08)}
            >
              ⌫
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Mounted per provider/connection target; owns one isolated, short-lived remote browser. */
export function BillingBrowserLogin({
  request,
  apiBase,
  current,
  onSuccess,
}: {
  request: BillingBrowserRequest;
  apiBase: string;
  current: () => boolean;
  onSuccess: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [api] = useState(createBillingBrowserApi);
  const [session, setSession] = useState<BillingBrowserSession | null>(null);
  const [flow] = useState(() => createBrowserLoginFlow(api, current, setSession));
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    flow.activate();
    void api
      .capability()
      .then((capability) => {
        if (active.current && current()) setAvailable(capability.available);
      })
      .catch(() => {
        if (active.current && current()) setAvailable(false);
      });
    return () => {
      active.current = false;
      flow.dispose();
    };
  }, [api, current, flow]);
  useEffect(() => {
    if (!session) return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (time >= Date.parse(session.expiresAt)) {
        flow.cancel();
        setError('billing.browser_expired');
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [session, flow]);
  const run = async (action: () => Promise<unknown>) => {
    if (busy || !current()) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      if (active.current && current()) setError(billingErrorKey(error));
    } finally {
      if (active.current && current()) setBusy(false);
    }
  };
  return (
    <section aria-label={t('billing.browser_login')} className={styles.browserPanel}>
      <h3>{t('billing.browser_login')}</h3>
      <p>{t('billing.browser_hint')}</p>
      {error && (
        <p className="error-box" role="alert">
          {t(error)}
        </p>
      )}
      {available === null && <p role="status">{t('billing.browser_checking')}</p>}
      {available === false && <p role="status">{t('billing.browser_unavailable')}</p>}
      {!session && (
        <Button
          disabled={available !== true || busy || !request.label.trim()}
          loading={busy}
          onClick={() => void run(() => flow.start(request))}
        >
          {t('billing.browser_start')}
        </Button>
      )}
      {session && (
        <>
          <p>
            {t('billing.browser_expiry', {
              seconds: Math.max(0, Math.ceil((Date.parse(session.expiresAt) - now) / 1000)),
            })}
          </p>
          <BrowserViewer session={session} api={api} apiBase={apiBase} current={current} />
          <div className={styles.actions}>
            <Button
              loading={busy}
              onClick={() =>
                void run(async () => {
                  const saved = await flow.finish();
                  if (saved && active.current && current()) await onSuccess();
                })
              }
            >
              {t('billing.browser_finish')}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                flow.cancel();
                setError('');
              }}
            >
              {t('billing.browser_cancel')}
            </Button>
          </div>
        </>
      )}
      {!session && busy && (
        <Button
          variant="secondary"
          onClick={() => {
            flow.cancel();
            setBusy(false);
          }}
        >
          {t('billing.browser_cancel')}
        </Button>
      )}
    </section>
  );
}
