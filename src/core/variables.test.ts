import { describe, expect, test } from 'vitest'
import { analyzeWorkflow } from './lineage'
import { evaluateExpression, expandTemplate, expandTemplateAcross } from './variables'

describe('evaluateExpression', () => {
  const scope = {
    set: { sample: { name: 'sample', tables: ['a', 'b'] } },
    params: 'sample',
    td: { database: 'td_lda' },
  }

  test('reads dotted properties', () => {
    expect(evaluateExpression('td.database', scope)).toBe('td_lda')
  })

  test('indexes with another variable', () => {
    expect(evaluateExpression('set[params].name', scope)).toBe('sample')
  })

  test('indexes arrays and string keys', () => {
    expect(evaluateExpression("set['sample'].tables[1]", scope)).toBe('b')
  })

  test('supports Object.keys', () => {
    expect(evaluateExpression('Object.keys(set)', scope)).toEqual(['sample'])
  })

  test('gives up on unknown names and unsupported syntax', () => {
    expect(evaluateExpression('missing.name', scope)).toBeUndefined()
    expect(evaluateExpression('session_date', scope)).toBeUndefined()
    expect(evaluateExpression('a + b', scope)).toBeUndefined()
  })
})

describe('expandTemplate', () => {
  const scope = { td: { database: 'td_lda' } }

  test('substitutes what it can and keeps the rest', () => {
    const expansion = expandTemplate('${td.database}.run_${session_date}', scope)
    expect(expansion.text).toBe('td_lda.run_${session_date}')
    expect(expansion.resolved).toBe(false)
  })

  test('reports a fully resolved name', () => {
    expect(expandTemplate('${td.database}.events', scope)).toEqual({ text: 'td_lda.events', resolved: true })
  })

  test('returns one result per distinct expansion', () => {
    const expansions = expandTemplateAcross('pred_${name}', [{ name: 'a' }, { name: 'b' }, { name: 'a' }])
    expect(expansions.map((expansion) => expansion.text)).toEqual(['pred_a', 'pred_b'])
  })
})

describe('analyzeWorkflow with variables', () => {
  const workflow = `
_export:
  td:
    database: td_lda
  suffix: prod

+load:
  for_each>:
    part:
      - first
      - second
  _do:
    +write:
      td>: |
        select * from raw_\${part}_\${suffix}
      insert_into: staged_\${part}
`

  const analysis = analyzeWorkflow([{ path: 'main.dig', text: workflow }])
  const write = analysis.tasks.find((item) => item.task.name === '+write')

  test('expands a loop into one table per iteration', () => {
    expect(write?.sql?.targets.map((target) => target.qualifiedName).sort())
      .toEqual(['td_lda.staged_first', 'td_lda.staged_second'])
    expect(write?.sql?.sources.map((source) => source.qualifiedName).sort())
      .toEqual(['td_lda.raw_first_prod', 'td_lda.raw_second_prod'])
  })

  test('keeps the original expression on each reference', () => {
    expect(write?.sql?.targets[0]?.template).toBe('td_lda.staged_${part}')
  })

  test('qualifies both sides with the database so lineage connects', () => {
    expect(analysis.tableLineage.map((record) => `${record.source.qualifiedName}->${record.target.qualifiedName}`).sort())
      .toEqual([
        'td_lda.raw_first_prod->td_lda.staged_first',
        'td_lda.raw_second_prod->td_lda.staged_second',
      ])
  })
})

describe('analyzeWorkflow with an unresolvable name', () => {
  const workflow = `
_export:
  td:
    database: td_lda

+daily:
  td>: |
    select * from events_\${session_date}
`
  const analysis = analyzeWorkflow([{ path: 'main.dig', text: workflow }])
  const daily = analysis.tasks.find((item) => item.task.name === '+daily')

  test('keeps the whole expression rather than truncating at the dollar sign', () => {
    expect(daily?.sql?.sources[0]?.qualifiedName).toBe('td_lda.events_${session_date}')
    expect(daily?.sql?.sources[0]?.confidence).toBe('unresolved')
  })
})
