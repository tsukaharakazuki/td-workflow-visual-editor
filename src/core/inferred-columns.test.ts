import { describe, expect, test } from 'vitest'
import { analyzeWorkflow, inferredTableFor } from './index'

const workflow = `
_export:
  td:
    database: mart

+build:
  td>: |
    SELECT
      u.user_id,
      MAX(e.event_time) AS last_seen,
      COUNT(*) AS visits
    FROM raw.events e
    JOIN raw.users u ON u.user_id = e.user_id
    WHERE e.status = 'ok'
    GROUP BY u.user_id
  insert_into: user_activity

+copy:
  td>: |
    -- WF: pass everything through
    SELECT * FROM mart.user_activity
  create_table: user_activity_copy
`

const analysis = analyzeWorkflow([{ path: 'main.dig', text: workflow }])
const columnsOf = (name: string) =>
  inferredTableFor(name, analysis.inferredTables)?.columns.map((column) => column.name) ?? []

describe('columns inferred from SQL', () => {
  test('a written table takes the select list', () => {
    expect(columnsOf('mart.user_activity')).toEqual(
      expect.arrayContaining(['user_id', 'last_seen', 'visits']),
    )
  })

  test('a read table takes the columns the query mentions against it', () => {
    expect(columnsOf('raw.events')).toEqual(expect.arrayContaining(['event_time', 'user_id', 'status']))
    expect(columnsOf('raw.users')).toEqual(expect.arrayContaining(['user_id']))
  })

  test('SELECT * lists the wildcard first', () => {
    const columns = columnsOf('mart.user_activity')
    expect(columns[0]).toBe('*')
    expect(columnsOf('mart.user_activity_copy')).toEqual(['*'])
  })

  test('function names, keywords and aliases are not columns', () => {
    const events = columnsOf('raw.events')
    for (const word of ['max', 'count', 'select', 'from', 'join', 'where', 'group', 'by', 'last_seen', 'visits', 'e', 'u']) {
      expect(events.map((name) => name.toLowerCase())).not.toContain(word)
    }
  })

  test('words inside comments are not columns', () => {
    expect(columnsOf('mart.user_activity').map((name) => name.toLowerCase())).not.toContain('wf')
  })

})

describe('non-table sources', () => {
  test('UNNEST after a join is not read as a table', () => {
    const unnested = analyzeWorkflow([{
      path: 'main.dig',
      text: `
_export:
  td:
    database: mart

+flatten:
  td>: |
    SELECT t.id, i.item
    FROM raw.carts t
    CROSS JOIN UNNEST(t.items) AS i (item)
  insert_into: cart_items
`,
    }])
    const names = unnested.tasks.flatMap((item) => item.sql?.sources.map((source) => source.name) ?? [])
    expect(names).toContain('carts')
    expect(names.map((name) => name.toLowerCase())).not.toContain('unnest')
  })
})
