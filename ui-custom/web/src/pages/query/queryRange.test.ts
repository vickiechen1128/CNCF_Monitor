import { describe, expect, it } from 'vitest'
import {
  DEFAULT_QUERY,
  buildQuerySearch,
  buildSelector,
  computeStep,
  formatLabels,
  isAbortError,
  matchQuickRange,
  niceStep,
  parseBareMetric,
  parseQueryState,
  promqlString,
  queryLengthBytes,
  resolveQuickRange,
  summarizeSeries,
  toGrid,
} from './queryRange'

describe('niceStep / computeStep', () => {
  it('normalizes to common steps with a 15s floor', () => {
    expect(niceStep(1)).toBe(15)
    expect(niceStep(15)).toBe(15)
    expect(niceStep(16)).toBe(30)
    expect(niceStep(1000)).toBe(1800)
  })

  it('targets about 1000 points for a 6h window', () => {
    expect(computeStep(0, 6 * 3600)).toBe(30)
    expect(computeStep(0, 3600)).toBe(15)
    expect(computeStep(0, 7 * 24 * 3600)).toBe(900)
  })
})

describe('resolveQuickRange / matchQuickRange', () => {
  it('resolves a quick range relative to now', () => {
    expect(resolveQuickRange('1h', 1_000_000)).toEqual({ from: 996_400, to: 1_000_000 })
  })

  it('matches a quick range from a window', () => {
    expect(matchQuickRange(1_000_000 - 3600, 1_000_000)).toBe('1h')
    expect(matchQuickRange(0, 1234)).toBeUndefined()
  })
})

describe('toGrid', () => {
  it('fills missing points with null and keeps 0 as a real value', () => {
    const grid = toGrid(
      [
        {
          metric: { __name__: 'up', job: 'node' },
          values: [
            [0, '1'],
            [30, '2'],
            [90, '0'],
          ],
        },
      ],
      0,
      90,
      30,
    )

    expect(grid).toEqual([
      {
        label: 'up{job="node"}',
        data: [
          [0, 1],
          [30_000, 2],
          [60_000, null],
          [90_000, 0],
        ],
      },
    ])
  })

  it('treats NaN / +Inf / -Inf as gaps', () => {
    const grid = toGrid(
      [{ metric: { __name__: 'x' }, values: [[0, 'NaN'], [15, '+Inf'], [30, '-Inf']] }],
      0,
      30,
      15,
    )
    expect(grid[0].data).toEqual([
      [0, null],
      [15_000, null],
      [30_000, null],
    ])
  })
})

describe('summarizeSeries', () => {
  it('computes latest/min/max/avg over finite values and counts 0', () => {
    expect(
      summarizeSeries([
        [0, '0'],
        [15, '1'],
        [30, 'NaN'],
        [45, '3'],
      ]),
    ).toEqual({ latest: 3, min: 0, max: 3, avg: 4 / 3, count: 3 })
  })

  it('returns empty stats when no finite value exists', () => {
    expect(summarizeSeries([[0, 'NaN']])).toEqual({
      latest: null,
      min: null,
      max: null,
      avg: null,
      count: 0,
    })
  })
})

describe('labels and escaping', () => {
  it('formats labels with a stable key order', () => {
    expect(
      formatLabels({ __name__: 'up', job: 'node', instance: '10.0.0.1:9100' }),
    ).toBe('up{instance="10.0.0.1:9100", job="node"}')
    expect(formatLabels({ job: 'node' })).toBe('{job="node"}')
    expect(formatLabels({})).toBe('{}')
  })

  it('escapes PromQL string literals', () => {
    expect(promqlString('a"b\\c\n')).toBe('a\\"b\\\\c\\n')
  })

  it('builds a metric selector from auxiliary pickers', () => {
    expect(buildSelector('up')).toBe('up')
    expect(buildSelector('up', { job: 'node' })).toBe('up{job="node"}')
    expect(
      buildSelector('up', { job: 'node', instance: '10.0.0.1:9100' }),
    ).toBe('up{job="node", instance="10.0.0.1:9100"}')
    expect(buildSelector('up', { job: 'a"b' })).toBe('up{job="a\\"b"}')
  })

  it('only treats a bare metric name as builder-compatible', () => {
    expect(parseBareMetric(' up ')).toBe('up')
    expect(parseBareMetric('node_cpu_seconds_total')).toBe('node_cpu_seconds_total')
    expect(parseBareMetric('count(up)')).toBeUndefined()
    expect(parseBareMetric('up{job="node"}')).toBeUndefined()
  })

  it('counts UTF-8 bytes for the 8 KiB guard', () => {
    expect(queryLengthBytes('中')).toBe(3)
  })
})

describe('parseQueryState / buildQuerySearch', () => {
  const now = 1_000_000

  it('falls back to up + last 6h when the URL is empty', () => {
    const state = parseQueryState(new URLSearchParams(), now)
    expect(state.expr).toBe(DEFAULT_QUERY)
    expect(state.from).toBe(now - 6 * 3600)
    expect(state.to).toBe(now)
    expect(state.step).toBe(30)
  })

  it('uses a valid preset before expr', () => {
    const state = parseQueryState(new URLSearchParams('preset=cpu&expr=ignored'), now)
    expect(state.expr).toContain('node_cpu_seconds_total')
    expect(state.preset).toBe('cpu')
  })

  it('keeps a valid custom window and step', () => {
    const state = parseQueryState(
      new URLSearchParams('expr=up&from=1000&to=4600&step=60'),
      now,
    )
    expect(state).toMatchObject({ expr: 'up', from: 1000, to: 4600, step: 60 })
  })

  it('falls back on an invalid window or step', () => {
    const state = parseQueryState(
      new URLSearchParams('expr=up&from=5000&to=1000&step=5'),
      now,
    )
    expect(state.from).toBe(now - 6 * 3600)
    expect(state.to).toBe(now)
    expect(state.step).toBe(30)
  })

  it('round-trips through URL params', () => {
    const state = parseQueryState(
      new URLSearchParams('expr=up&from=1000&to=4600&step=60'),
      now,
    )
    const params = buildQuerySearch(state)
    expect(params).toEqual({ expr: 'up', from: '1000', to: '4600', step: '60' })
    expect(parseQueryState(new URLSearchParams(params), now)).toEqual(state)
  })
})

describe('isAbortError', () => {
  it('recognizes AbortController cancellations', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true)
    expect(isAbortError({ name: 'AbortError' })).toBe(true)
    expect(isAbortError(new Error('boom'))).toBe(false)
  })
})
