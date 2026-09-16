import { describe, expect, test } from 'vitest'
import { parseDigdagDocument } from './digdag'
import {
  renameDigdagTask,
  setDigdagTaskConfig,
  setDigdagTaskExport,
  setDigdagTaskFields,
  setDigdagTaskQuery,
  setDigdagWorkflowExport,
} from './task-edit'

const WORKFLOW = `
_export:
  td:
    database: td_main

+extract:
  td>: queries/extract.sql
  create_table: events
  engine: presto

+inline:
  td>: |
    select 1
  insert_into: summary

+sibling_query:
  td>:
  query: select 2

+nested:
  for_each>:
    part:
      - a
  _do:
    +run:
      td>: |
        select 3
`

const parse = () => parseDigdagDocument(WORKFLOW, { path: 'main.dig' })
const idOf = (name: string) => parse().tasks.find((task) => task.name === name)?.id ?? ''

describe('renameDigdagTask', () => {
  test('renames the key and keeps the body', () => {
    const result = renameDigdagTask(parse(), idOf('+extract'), 'extract_events')
    expect(result.after.text).toContain('+extract_events:')
    expect(result.after.text).toContain('queries/extract.sql')
    expect(result.document.tasks.some((task) => task.name === '+extract_events')).toBe(true)
  })

  test('accepts a name already carrying the plus', () => {
    expect(renameDigdagTask(parse(), idOf('+extract'), '+renamed').after.text).toContain('+renamed:')
  })

  test('refuses a duplicate or an unusable name', () => {
    expect(() => renameDigdagTask(parse(), idOf('+extract'), 'inline')).toThrow(/exists/i)
    expect(() => renameDigdagTask(parse(), idOf('+extract'), '  ')).toThrow(/empty/i)
    expect(() => renameDigdagTask(parse(), idOf('+extract'), 'two words')).toThrow(/spaces/i)
  })

  test('renames a task nested under _do', () => {
    const result = renameDigdagTask(parse(), idOf('+run'), 'run_part')
    expect(result.after.text).toContain('+run_part:')
  })
})

describe('setDigdagTaskFields', () => {
  test('sets a value and clears it again', () => {
    const set = setDigdagTaskFields(parse(), idOf('+extract'), { engine: 'hive', database: 'td_other' })
    expect(set.after.text).toContain('engine: hive')
    expect(set.after.text).toContain('database: td_other')
    const cleared = setDigdagTaskFields(set.document, idOf('+extract'), { engine: '' })
    expect(cleared.after.text).not.toContain('engine: hive')
  })
})

describe('setDigdagTaskQuery', () => {
  test('rewrites a query written on the operator key', () => {
    const result = setDigdagTaskQuery(parse(), idOf('+inline'), 'select 1\nfrom events')
    expect(result.after.text).toContain('from events')
    expect(result.document.tasks.find((task) => task.name === '+inline')?.sql?.text).toBe('select 1\nfrom events')
  })

  test('rewrites a query sitting beside an empty operator key', () => {
    const result = setDigdagTaskQuery(parse(), idOf('+sibling_query'), 'select 22')
    expect(result.after.text).toContain('select 22')
    expect(result.document.tasks.find((task) => task.name === '+sibling_query')?.sql?.text).toBe('select 22')
  })

  test('rewrites a query on a task nested under _do', () => {
    const result = setDigdagTaskQuery(parse(), idOf('+run'), 'select 33')
    expect(result.document.tasks.find((task) => task.name === '+run')?.sql?.text).toBe('select 33')
  })

  test('leaves a file-backed query to the file itself', () => {
    expect(() => setDigdagTaskQuery(parse(), idOf('+extract'), 'select 1')).toThrow(/file/i)
  })
})

describe('setDigdagTaskConfig', () => {
  test('writes values with their YAML type, not as strings', () => {
    const text = setDigdagTaskConfig(parse(), idOf('+extract'), {
      priority: 2,
      preview: true,
      result_settings: { bucket: 'reports' },
    }).after.text
    expect(text).toMatch(/priority: 2\b/)
    expect(text).toMatch(/preview: true\b/)
    expect(text).toContain('bucket: reports')
    expect(text).not.toContain('"2"')
  })

  test('undefined removes the key', () => {
    const text = setDigdagTaskConfig(parse(), idOf('+extract'), { engine: undefined }).after.text
    expect(text).not.toContain('engine: presto')
    expect(text).toContain('create_table: events')
  })

  test('reaches an operator that lives under _do', () => {
    const text = setDigdagTaskConfig(parse(), idOf('+run'), { database: 'staging' }).after.text
    expect(text).toContain('database: staging')
  })
})

describe('setDigdagTaskExport', () => {
  test('adds _export at the top of the task, not after its operator', () => {
    const text = setDigdagTaskExport(parse(), idOf('+extract'), { region: 'jp', retries: 3 }).after.text
    const task = text.slice(text.indexOf('+extract:'))
    expect(task.indexOf('_export:')).toBeLessThan(task.indexOf('td>:'))
    expect(task).toMatch(/retries: 3\b/)
  })

  test('an empty block removes _export', () => {
    const withExport = setDigdagTaskExport(parse(), idOf('+extract'), { region: 'jp' })
    const cleared = setDigdagTaskExport(withExport.document, idOf('+extract'), {})
    expect(cleared.after.text).not.toContain('region: jp')
  })

  test('the task keeps reading its own variables back', () => {
    const result = setDigdagTaskExport(parse(), idOf('+extract'), { region: 'jp' })
    const task = result.document.tasks.find((item) => item.name === '+extract')
    expect(result.document.taskVariables[task?.id ?? '']?.[0]?.region).toBe('jp')
  })
})

describe('setDigdagWorkflowExport', () => {
  test('replaces the root block and leaves the tasks alone', () => {
    const text = setDigdagWorkflowExport(parse(), { td: { database: 'td_other' }, env: 'prod' }).after.text
    expect(text).toContain('database: td_other')
    expect(text).toContain('env: prod')
    expect(text).toContain('+extract:')
    expect(text.indexOf('_export:')).toBeLessThan(text.indexOf('+extract:'))
  })

  test('an empty block removes the root _export', () => {
    const text = setDigdagWorkflowExport(parse(), {}).after.text
    expect(text).not.toContain('_export:')
    expect(text).toContain('+extract:')
  })
})
