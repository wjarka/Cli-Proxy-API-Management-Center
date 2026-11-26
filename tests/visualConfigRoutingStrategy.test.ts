import { describe, expect, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse as parseYaml } from 'yaml';
import { parseRoutingStrategy, useVisualConfig } from '../src/hooks/useVisualConfig';
import { runVisualConfig } from './helpers/visualConfig';

describe('visual config routing strategies', () => {
  test('preserves earliest-reset when loading the visual editor', () => {
    expect(parseRoutingStrategy('earliest-reset')).toBe('earliest-reset');
    expect(parseRoutingStrategy(' EARLIEST-RESET ')).toBe('earliest-reset');
  });

  test('loads and saves earliest-reset without changing session affinity', () => {
    const source = 'routing:\n  strategy: earliest-reset\n  session-affinity: true\n';
    const loaded = runVisualConfig(source);
    expect(loaded.visualValues.routingStrategy).toBe('earliest-reset');
    expect(parseYaml(loaded.applyVisualChangesToYaml(source))).toEqual(parseYaml(source));

    const initial = 'routing:\n  strategy: round-robin\n  session-affinity: true\n';
    const edited = runVisualConfig(initial, [{ routingStrategy: 'earliest-reset' }]);
    expect(parseYaml(edited.applyVisualChangesToYaml(initial))).toEqual(parseYaml(source));
  });

  for (const affinity of [true, false]) {
    test(`changing to earliest-reset preserves affinity=${affinity}, TTL and subagent settings`, () => {
      const source = `routing:
  strategy: weighted-round-robin
  session-affinity: ${affinity}
  session-affinity-ttl: 2h
  session-affinity-subagents: false
  future-option: retained
`;
      const edited = runVisualConfig(source, [{ routingStrategy: 'earliest-reset' }]);
      const saved = edited.applyVisualChangesToYaml(source);
      expect(parseYaml(saved)).toEqual({
        routing: {
          strategy: 'earliest-reset',
          'session-affinity': affinity,
          'session-affinity-ttl': '2h',
          'session-affinity-subagents': false,
          'future-option': 'retained',
        },
      });
      const reloaded = runVisualConfig(saved);
      expect(reloaded.visualValues.routingStrategy).toBe('earliest-reset');
      expect(reloaded.visualValues.routingSessionAffinity).toBe(affinity);
      expect(reloaded.visualValues.routingSessionAffinityTTL).toBe('2h');
      expect(reloaded.visualValues.routingSessionAffinitySubagents).toBe(false);
      expect(reloaded.visualDirty).toBe(false);
    });
  }

  test('recognizes the weighted-round-robin backend value', () => {
    expect(parseRoutingStrategy('weighted-round-robin')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('weightedroundrobin')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('wrr')).toBe('weighted-round-robin');
    expect(parseRoutingStrategy('fill-first')).toBe('fill-first');
    expect(parseRoutingStrategy('fillfirst')).toBe('fill-first');
    expect(parseRoutingStrategy('ff')).toBe('fill-first');
    expect(parseRoutingStrategy(undefined)).toBe('round-robin');
  });

  test('writes weighted-round-robin without coercing it to round-robin', () => {
    function Harness() {
      const visualConfig = useVisualConfig();
      const [phase, setPhase] = useState(0);

      if (phase === 0) {
        visualConfig.setVisualValues({ routingStrategy: 'weighted-round-robin' });
        setPhase(1);
      } else {
        return createElement(
          'pre',
          null,
          visualConfig.applyVisualChangesToYaml('routing:\n  strategy: round-robin\n')
        );
      }

      return null;
    }

    const markup = renderToStaticMarkup(createElement(Harness));
    const result = markup.slice('<pre>'.length, -'</pre>'.length);

    expect(parseYaml(result)).toEqual({ routing: { strategy: 'weighted-round-robin' } });
  });
});
