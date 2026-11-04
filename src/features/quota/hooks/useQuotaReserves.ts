import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/services/api/client';
import { quotaReservesApi, type QuotaReserve } from '@/services/api/quotaReserves';
import { useQuotaStore } from '@/stores/useQuotaStore';

interface Snapshot {
  generation: number;
  revision: number;
  reserves: Record<string, QuotaReserve>;
  unavailable: boolean;
}

/** Load on entry or explicit refresh, scoped to the current connection. */
export function useQuotaReserves(connected: boolean, generation: number) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [reload, setReload] = useState(0);
  const revision = apiClient.getConnectionRevision();
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    let busy = false;
    const controller = new AbortController();
    const current = () =>
      !cancelled &&
      generation === useQuotaStore.getState().cacheGeneration &&
      revision === apiClient.getConnectionRevision();
    const load = async () => {
      if (busy || !current()) return;
      busy = true;
      try {
        const reserves = await quotaReservesApi.get(controller.signal);
        if (current()) setSnapshot({ generation, revision, reserves, unavailable: false });
      } catch {
        if (current()) setSnapshot({ generation, revision, reserves: {}, unavailable: true });
      } finally {
        busy = false;
      }
    };
    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [connected, generation, revision, reload]);
  const visible =
    connected && snapshot?.generation === generation && snapshot.revision === revision;
  return {
    reserves: visible ? snapshot.reserves : {},
    unavailable: visible ? snapshot.unavailable : false,
    refresh,
  };
}
