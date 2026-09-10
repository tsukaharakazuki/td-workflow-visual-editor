import { describe, expect, test } from 'vitest'
import { parseDigdagDocument } from './digdag'
import { renameDigdagTask, setDigdagTaskFields, setDigdagTaskQuery } from './task-edit'

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
