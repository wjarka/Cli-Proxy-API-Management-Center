import { afterEach, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import i18n from '@/i18n';
import { apiClient } from '@/services/api/client';
import { providersApi, type ProviderFamily } from '@/services/api/providers';
import { normalizeProviderGroups } from '@/services/api/transformers';
import { claudeToResource } from '@/features/providers/adapters';
import { BaseProviderForm } from '@/features/providers/sheets/forms/BaseProviderForm';
import { ApiKeyEntriesEditor } from '@/features/providers/sheets/forms/ApiKeyEntriesEditor';
import type { OpenAIProviderConfig, ProviderKeyConfig } from '@/types';

const localI18n = i18n.cloneInstance({ lng: 'en' });
const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nextProvider, { i18n: localI18n }, element));
const oldGet = apiClient.get,
  oldPut = apiClient.put;
afterEach(() => {
  apiClient.get = oldGet;
  apiClient.put = oldPut;
});
function backend(family: ProviderFamily, initial: Record<string, unknown>) {
  let group = structuredClone(initial);
  apiClient.get = (async () => ({
    'api-keys': { [family]: [structuredClone(group)] },
  })) as typeof apiClient.get;
  apiClient.put = (async (path: string, groups: Record<string, unknown>[]) => {
    expect(path).toBe(`/config/api-keys/${family}`);
    group = structuredClone(groups[0]);
  }) as typeof apiClient.put;
  return () => group;
}
const rows = (group: Record<string, unknown>) =>
  normalizeProviderGroups([group]) as ProviderKeyConfig[];
const families = [
  ['gemini', providersApi.updateGeminiKey],
  ['interactions', providersApi.updateInteractionsKey],
  ['claude', providersApi.updateClaudeConfig],
  ['codex', providersApi.updateCodexConfig],
  ['xai', providersApi.updateXAIConfig],
  ['meta', providersApi.updateMetaConfig],
  ['vertex', providersApi.updateVertexConfig],
] as const;
for (const [family, update] of families) {
  test(`${family} key label round-trips, survives unrelated edits, and clears without changing siblings or group`, async () => {
    const initial = {
      name: 'Shared group',
      future: 'keep',
      keys: [
        { 'api-key': 'fixture-key-a', label: ' Work ', unknown: { untouched: true } },
        { 'api-key': 'fixture-key-b', label: 'Personal' },
      ],
    };
    const group = backend(family, initial);
    let first = rows(group())[0];
    const second = rows(group())[1];
    expect(first.label).toBe('Work');
    expect(second.label).toBe('Personal');
    await update(first.apiKey, first.baseUrl, { ...first, weight: 3 });
    expect(group()).toEqual({
      ...initial,
      keys: [{ ...initial.keys[0], weight: 3 }, initial.keys[1]],
    });
    first = rows(group())[0];
    await update(first.apiKey, first.baseUrl, { ...first, label: ' Renamed ' });
    expect((group().keys as Record<string, unknown>[])[0]).toMatchObject({
      label: 'Renamed',
      'api-key': 'fixture-key-a',
      weight: 3,
      unknown: { untouched: true },
    });
    first = rows(group())[0];
    await update(first.apiKey, first.baseUrl, { ...first, label: '' });
    expect((group().keys as Record<string, unknown>[])[0]).not.toHaveProperty('label');
    expect((group().keys as Record<string, unknown>[])[1]).toEqual(initial.keys[1]);
    expect(group().name).toBe('Shared group');
  });
}

test('OpenAI entry names remain per-key through reorder, rename, clear and unrelated group edits', async () => {
  const a = {
    'api-key': 'shared-key',
    'proxy-url': 'http://a.invalid',
    label: 'Work',
    future: 'A',
  };
  const b = {
    'api-key': 'shared-key',
    'proxy-url': 'http://b.invalid',
    label: 'Personal',
    future: 'B',
  };
  const initial = {
    name: 'OpenAI group',
    'base-url': 'https://api.openai.com/v1',
    future: 'keep',
    keys: [a, b],
  };
  const group = backend('openai-compatibility', initial);
  const config = () => normalizeProviderGroups([group()], true)[0] as OpenAIProviderConfig;
  let current = config();
  expect(current.apiKeyEntries.map((entry) => entry.label)).toEqual(['Work', 'Personal']);
  await providersApi.updateOpenAIProvider(current.name, 0, { ...current, priority: 7 });
  expect(group()).toEqual({ ...initial, priority: 7 });
  current = config();
  await providersApi.updateOpenAIProvider(current.name, 0, {
    ...current,
    apiKeyEntries: [
      { ...current.apiKeyEntries[1], label: ' Personal renamed ' },
      { ...current.apiKeyEntries[0], label: '' },
    ],
  });
  expect(group()).toEqual({
    ...initial,
    priority: 7,
    keys: [
      { ...b, label: 'Personal renamed' },
      { 'api-key': a['api-key'], 'proxy-url': a['proxy-url'], future: 'A' },
    ],
  });
});

test('per-key labels precede group fallback without changing resource identity or leaking raw API keys', () => {
  const group = {
    name: 'Shared group',
    label: 'Invalid group label',
    keys: [{ 'api-key': 'fixture-secret-key', label: 'Work' }, { 'api-key': 'another-secret-key' }],
  };
  const [named, unnamed] = rows(group);
  const original = claudeToResource({ ...named, label: undefined }, 0);
  const resource = claudeToResource(named, 0);
  expect(resource.name).toBe('Work');
  expect(claudeToResource(unnamed, 1).name).toBe('Shared group');
  expect(resource.id).toBe(original.id);
  expect(resource.selector).toEqual(original.selector);
  expect(resource.identifier).not.toContain('fixture-secret-key');
});

test('native form has an optional labelled key-name input and keeps the edit password blank', () => {
  const config = rows({
    name: 'Group',
    keys: [{ 'api-key': 'fixture-secret-key', label: 'Work' }],
  })[0];
  const markup = render(
    createElement(BaseProviderForm, {
      brand: 'claude',
      resource: claudeToResource(config, 0),
      mode: 'edit',
      mutating: false,
      formId: 'fixture-form',
      onSubmit: async () => {},
    })
  );
  expect(markup).toMatch(/<label[^>]+for="([^"]+-keyLabel)"[^>]*>Key name<\/label>/);
  expect(markup).toMatch(/<input[^>]+id="[^"]+-keyLabel"[^>]+value="Work"/);
  expect(markup).toContain('Leave empty to use the default name.');
  expect(markup).not.toContain('fixture-secret-key');
});

test('OpenAI collapsed rows show distinct labels before masked keys and never raw keys', () => {
  const markup = render(
    createElement(ApiKeyEntriesEditor, {
      entries: [
        { apiKey: '', existingApiKey: 'fixture-secret-key-a', label: 'Work', proxyUrl: '' },
        { apiKey: '', existingApiKey: 'fixture-secret-key-b', label: 'Personal', proxyUrl: '' },
      ],
      removeDisabled: false,
      mutating: false,
      statuses: [],
      isTestingAny: false,
      onUpdate: () => {},
      onAdd: () => 2,
      onRemove: () => {},
      onTest: () => {},
      onTestAll: () => {},
    })
  );
  expect(markup).toContain('Work');
  expect(markup).toContain('Personal');
  expect(markup).not.toContain('fixture-secret-key-a');
  expect(markup).not.toContain('fixture-secret-key-b');
});

test('all five locales translate the optional key name and default-name hint', async () => {
  for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi']) {
    const data = await Bun.file(
      new URL(`../src/i18n/locales/${locale}.json`, import.meta.url)
    ).json();
    expect(data.providersPage.form.keyLabel).toBeTruthy();
    expect(data.providersPage.form.keyLabelHint).toBeTruthy();
  }
});

test('native resource table actually displays each key name with a masked credential preview', async () => {
  const { ProviderResourceTable } =
    await import('@/features/providers/components/ProviderResourceTable');
  const config = rows({
    name: 'Group',
    keys: [{ 'api-key': 'fixture-secret-key', label: 'Named work key' }],
  })[0];
  const markup = render(
    createElement(ProviderResourceTable, {
      resources: [claudeToResource(config, 0)],
      onView: () => {},
      onEdit: () => {},
      onDelete: () => {},
    })
  );
  expect(markup).toContain('Named work key');
  expect(markup).toContain('fi******ey');
  expect(markup).not.toContain('fixture-secret-key');
});
