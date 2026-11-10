import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@/services/api/client';
import { useQuotaStore } from '@/stores/useQuotaStore';
import {
  ConsoleQuotaController,
  emptyConsoleQuotaState,
  type ConsoleQuotaState,
} from '../consoleQuotaController';

interface ControllerScope {
  controller: ConsoleQuotaController;
  key: { connected: boolean; generation: number; revision: number };
}

interface ScopedState {
  scope: ControllerScope;
  state: ConsoleQuotaState;
}

export function useConsoleQuota(connected: boolean, generation: number) {
  const revision = apiClient.getConnectionRevision();
  const key = useMemo(
    () => ({ connected, generation, revision }),
    [connected, generation, revision]
  );
  const controller = useRef<ControllerScope | null>(null);
  const [result, setResult] = useState<ScopedState | null>(null);

  useEffect(() => {
    if (!key.connected) return;
    const isCurrent = () =>
      controller.current?.key === key &&
      useQuotaStore.getState().cacheGeneration === key.generation &&
      apiClient.getConnectionRevision() === key.revision;
    const instance = new ConsoleQuotaController({
      transport: apiClient.createConnectionScope(),
      isCurrent,
      onChange: (state) => setResult({ scope, state }),
    });
    const scope = { controller: instance, key };
    controller.current = scope;
    void instance.reload();
    return () => {
      instance.dispose();
      if (controller.current === scope) controller.current = null;
    };
  }, [key]);

  const getController = useCallback(() => {
    const scope = controller.current;
    if (
      !key.connected ||
      !scope ||
      scope.key !== key ||
      useQuotaStore.getState().cacheGeneration !== key.generation ||
      apiClient.getConnectionRevision() !== key.revision
    ) {
      return null;
    }
    return scope.controller;
  }, [key]);

  const reload = useCallback(async () => {
    await getController()?.reload();
  }, [getController]);
  const refreshConnections = useCallback(
    async (ids: string[]) => {
      await getController()?.refreshConnections(ids);
    },
    [getController]
  );

  const visible =
    connected && result && result.scope.key === key ? result.state : emptyConsoleQuotaState();

  return { ...visible, reload, refreshConnections };
}
