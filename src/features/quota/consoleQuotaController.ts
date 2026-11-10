import {
  billingErrorKey,
  normalizeBillingSnapshot,
  type BillingSnapshot,
} from '@/services/api/billing';

export interface ConsoleQuotaState {
  snapshot: BillingSnapshot;
  loading: boolean;
  errorKey: string | null;
  refreshingIds: ReadonlySet<string>;
  actionErrors: Record<string, string>;
}

interface ConsoleQuotaTransport {
  get: (path: string, config: { signal: AbortSignal }) => Promise<unknown>;
  post: (path: string, data: undefined, config: { signal: AbortSignal }) => Promise<unknown>;
}

interface ConsoleQuotaOptions {
  transport: ConsoleQuotaTransport;
  isCurrent: () => boolean;
  onChange: (state: ConsoleQuotaState) => void;
}

export const emptyConsoleQuotaState = (): ConsoleQuotaState => ({
  snapshot: normalizeBillingSnapshot({}),
  loading: false,
  errorKey: null,
  refreshingIds: new Set(),
  actionErrors: {},
});

/** Owns one mounted Console quota view, pinned to one management connection. */
export class ConsoleQuotaController {
  private state = emptyConsoleQuotaState();
  private readonly abort = new AbortController();
  private disposed = false;
  private loadSequence = 0;

  constructor(private readonly options: ConsoleQuotaOptions) {}

  getState(): ConsoleQuotaState {
    return this.state;
  }

  private active(): boolean {
    return !this.disposed && this.options.isCurrent();
  }

  private update(patch: Partial<ConsoleQuotaState>): void {
    if (!this.active()) return;
    this.state = { ...this.state, ...patch };
    this.options.onChange(this.state);
  }

  async reload(): Promise<void> {
    if (!this.active()) return;
    const sequence = ++this.loadSequence;
    this.update({ loading: true, errorKey: null });
    try {
      const raw = await this.options.transport.get('/billing', { signal: this.abort.signal });
      if (!this.active() || sequence !== this.loadSequence) return;
      const snapshot = normalizeBillingSnapshot(raw);
      const actionErrors = { ...this.state.actionErrors };
      for (const connection of snapshot.connections) {
        const previous = this.state.snapshot.connections.find((item) => item.id === connection.id);
        if (
          connection.status === 'ready' &&
          previous &&
          (previous.status !== 'ready' || previous.updatedAt !== connection.updatedAt)
        ) {
          delete actionErrors[connection.id];
        }
      }
      this.update({ snapshot, actionErrors, loading: false, errorKey: null });
    } catch {
      if (sequence === this.loadSequence) {
        this.update({ loading: false, errorKey: 'console_quota.load_failed' });
      }
    }
  }

  async refreshConnections(ids: string[]): Promise<void> {
    if (!this.active()) return;
    // Refresh-all must also discover organizations after a failed or empty first read.
    if (ids.length === 0) {
      await this.reload();
      return;
    }
    const known = new Set(this.state.snapshot.connections.map((connection) => connection.id));
    const selected = [...new Set(ids)].filter(
      (id) => id && known.has(id) && !this.state.refreshingIds.has(id)
    );
    if (!selected.length) return;

    const refreshingIds = new Set(this.state.refreshingIds);
    const actionErrors = { ...this.state.actionErrors };
    selected.forEach((id) => {
      refreshingIds.add(id);
      delete actionErrors[id];
    });
    // Reserve before the first await so clicks on organizations sharing a connection deduplicate.
    this.update({ refreshingIds, actionErrors });
    await Promise.all(
      selected.map(async (id) => {
        if (!this.active()) return;
        try {
          await this.options.transport.post(
            `/billing/connections/${encodeURIComponent(id)}/refresh`,
            undefined,
            { signal: this.abort.signal }
          );
        } catch (error) {
          this.update({
            actionErrors: { ...this.state.actionErrors, [id]: billingErrorKey(error) },
          });
        }
      })
    );
    if (!this.active()) return;
    // A failed refresh can still change server-side status while retaining its last observation.
    await this.reload();
    const remaining = new Set(this.state.refreshingIds);
    selected.forEach((id) => remaining.delete(id));
    this.update({ refreshingIds: remaining });
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
  }
}
