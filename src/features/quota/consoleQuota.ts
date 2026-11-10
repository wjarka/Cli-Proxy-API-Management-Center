import type {
  BillingAccount,
  BillingConnection,
  BillingCredential,
  BillingSnapshot,
} from '@/services/api/billing';
import { billingAccountStatus } from '@/features/billing/logic';
import { filterEntriesBySearch, type QuotaFileEntry } from './logic';
import { QUOTA_VIEW_TAB_ORDER, type QuotaSortMode, type QuotaTabId } from './constants';

export interface ConsoleQuotaEntry {
  kind: 'console';
  type: 'claude' | 'openai';
  account: BillingAccount;
  connection?: BillingConnection;
  credentials: BillingCredential[];
}
export type QuotaBoardEntry =
  ConsoleQuotaEntry | { kind: 'oauth'; type: QuotaFileEntry['type']; entry: QuotaFileEntry };

/** Console organizations own shared pools; bindings only add public key labels. */
export function buildQuotaBoard(
  files: QuotaFileEntry[],
  billing: BillingSnapshot
): QuotaBoardEntry[] {
  const rows: QuotaBoardEntry[] = files.map((entry) => ({
    kind: 'oauth',
    type: entry.type,
    entry,
  }));
  const organizations = new Set<string>();
  for (const account of billing.accounts) {
    if (!account.id || !account.organizationId) continue;
    const identity = `${account.provider}:${account.organizationId}`;
    if (organizations.has(identity)) continue;
    organizations.add(identity);
    const connection = billing.connections.find(
      (candidate) =>
        candidate.id === account.connectionId &&
        candidate.provider === account.provider &&
        candidate.accountIds.includes(account.id)
    );
    const credentials: BillingCredential[] = [];
    const seenKeys = new Set<string>();
    for (const binding of billing.bindings) {
      if (binding.accountId !== account.id || seenKeys.has(binding.credentialId)) continue;
      const credential = billing.credentials.find(
        (candidate) =>
          candidate.id === binding.credentialId && candidate.provider === account.provider
      );
      if (!credential) continue;
      seenKeys.add(credential.id);
      credentials.push({
        id: credential.id,
        label: credential.label,
        provider: credential.provider,
        organizationId: credential.organizationId,
        verificationStatus:
          binding.verified && credential.verificationStatus === 'verified'
            ? 'verified'
            : 'unverified',
      });
    }
    rows.push({ kind: 'console', type: account.provider, account, connection, credentials });
  }
  return QUOTA_VIEW_TAB_ORDER.flatMap((type) => rows.filter((row) => row.type === type));
}

export function filterQuotaBoard(
  board: QuotaBoardEntry[],
  tab: QuotaTabId,
  search: string
): QuotaBoardEntry[] {
  const query = search.trim().toLowerCase();
  return board.filter((row) => {
    if (tab !== 'all' && row.type !== tab) return false;
    if (!query) return true;
    if (row.kind === 'oauth') return filterEntriesBySearch([row.entry], query).length > 0;
    return [
      row.account.name,
      row.account.organizationId,
      row.connection?.label,
      ...row.credentials.map((credential) => credential.label),
    ].some((value) => typeof value === 'string' && value.toLowerCase().includes(query));
  });
}

export function quotaBoardCounts(board: QuotaBoardEntry[]): Record<string, number> {
  const counts: Record<string, number> = { all: board.length };
  for (const type of QUOTA_VIEW_TAB_ORDER) counts[type] = 0;
  for (const row of board) counts[row.type]++;
  return counts;
}

export function consoleQuotaStatus(
  entry: ConsoleQuotaEntry,
  now: number
): BillingAccount['status'] {
  if (!entry.connection || entry.connection.status === 'reconnect_required') {
    return 'reconnect_required';
  }
  const status = billingAccountStatus(entry.account, now);
  if (status === 'ready' && entry.connection.status === 'error') return 'stale';
  return status;
}

/** A grant expiry is a loss of credit, never a recurring subscription recovery. */
export function nextCreditExpiryMs(entry: ConsoleQuotaEntry, now: number): number | null {
  if (
    consoleQuotaStatus(entry, now) !== 'ready' ||
    entry.account.balance === null ||
    entry.account.balance <= 0
  ) {
    return null;
  }
  let earliest: number | null = null;
  for (const grant of entry.account.grants) {
    if (grant.remaining === null || grant.remaining <= 0 || !grant.expiresAt) continue;
    const expiry = Date.parse(grant.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now) continue;
    earliest = earliest === null ? expiry : Math.min(earliest, expiry);
  }
  return earliest;
}

export function sortQuotaBoard(
  board: QuotaBoardEntry[],
  mode: QuotaSortMode,
  resolveRecovery: (entry: QuotaFileEntry) => number | null,
  now: number
): QuotaBoardEntry[] {
  if (mode === 'default') return [...board];
  return board
    .map((entry, index) => ({
      entry,
      index,
      at:
        mode === 'expiry'
          ? entry.kind === 'console'
            ? nextCreditExpiryMs(entry, now)
            : null
          : entry.kind === 'oauth'
            ? resolveRecovery(entry.entry)
            : null,
    }))
    .sort((a, b) => {
      if (a.at === null && b.at === null) return a.index - b.index;
      if (a.at === null) return 1;
      if (b.at === null) return -1;
      return a.at - b.at || a.index - b.index;
    })
    .map(({ entry }) => entry);
}
