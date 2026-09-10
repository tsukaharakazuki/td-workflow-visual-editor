import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  addSiblingTask,
  analyzeSql,
  analyzeWorkflow,
  deleteDigdagTask,
  exportWorkflowZip,
  ingestWorkflowZipSync,
  normalizeArchivePath,
  parseDigdagDocument,
  parseWorkflowSchema,
  reorderSiblingTasks,
} from './index'
import type { WorkflowArchive, WorkflowFile } from '../types'

function textFile(path: string, kind: WorkflowFile['kind'], text: string): WorkflowFile {
  return { path, kind, encoding: 'utf8', text, bytes: strToU8(text) }
}

describe('workflow ZIP safety', () => {
  it('ingests and classifies valid project files', () => {
    const bytes = zipSync({
      'project/main.dig': strToU8('+task:\n  echo>: hello\n'),
      'project/queries/main.sql': strToU8('select 1'),
      'project/schemas/workflow.schema.json': strToU8('{"format":"td-workflow-lineage-schema","version":1,"tables":[]}'),
    })
    const archive = ingestWorkflowZipSync(bytes)
    expect(archive.files.map((file) => file.kind)).toEqual(['dig', 'sql', 'schema'])
    expect(archive.expandedBytes).toBeGreaterThan(0)

    const roundTrip = ingestWorkflowZipSync(exportWorkflowZip(archive))
    expect(roundTrip.files.map((file) => [file.path, [...file.bytes]])).toEqual(
      archive.files.map((file) => [file.path, [...file.bytes]]),
    )
  })

  it('rejects traversal, absolute, and normalized duplicate paths', () => {
    expect(() => normalizeArchivePath('../secret.txt')).toThrow(/traverses/)
    expect(() => normalizeArchivePath('/tmp/file')).toThrow(/absolute/)
    const bytes = zipSync({
      'a/file.sql': strToU8('select 1'),
      'a//file.sql': strToU8('select 2'),
    })
    expect(() => ingestWorkflowZipSync(bytes)).toThrow(/Duplicate/)
  })

  it('enforces configured file limits', () => {
    const bytes = zipSync({ 'main.dig': strToU8('1234567890') })
    expect(() => ingestWorkflowZipSync(bytes, { maxFileBytes: 5 })).toThrow(/limit|beyond/)
  })
})

describe('Digdag parsing and editing', () => {
  const source = `_export:
  td:
    database: analytics
+extract:
  td>: queries/extract.sql
  create_table: stage
+branch:
  if>: \${enabled}
  _do:
    +aggregate:
      td>:
        query: |
          SELECT user_id, count(*) AS events
          FROM stage
          GROUP BY 1
      insert_into: summary
+publish:
  call>: finalize
`

  it('builds a hierarchical task model with inherited context', () => {
    const parsed = parseDigdagDocument(source, { path: 'main.dig' })
    expect(parsed.rootTaskIds).toHaveLength(3)
    const aggregate = parsed.tasks.find((task) => task.name === '+aggregate')
    expect(aggregate?.parentId).toBe(parsed.tasks.find((task) => task.name === '+branch')?.id)
    expect(aggregate?.database).toBe('analytics')
    expect(aggregate?.sql?.kind).toBe('inline')
  })

  it('does not invent sequential execution inside a parallel group', () => {
    const parallel = analyzeWorkflow([{ path: 'parallel.dig', text: `+parallel:
  _parallel: true
  +left:
    echo>: left
  +right:
    echo>: right
` }])
    const left = parallel.tasks.find((item) => item.task.name === '+left')!.task
    const right = parallel.tasks.find((item) => item.task.name === '+right')!.task
    expect(parallel.edges.some((edge) => edge.kind === 'sequence' && edge.from === left.id && edge.to === right.id)).toBe(false)
  })

  it('adds, deletes, and reorders sibling tasks', () => {
    const parsed = parseDigdagDocument(source, { path: 'main.dig' })
    const extract = parsed.tasks.find((task) => task.name === '+extract')!
    const added = addSiblingTask(parsed, extract.id, 'quality_check', { 'echo>': 'ok' })
    expect(added.document.rootTaskIds).toHaveLength(4)
    const quality = added.document.tasks.find((task) => task.name === '+quality_check')!
    const deleted = deleteDigdagTask(added.document, quality.id)
    expect(deleted.document.rootTaskIds).toHaveLength(3)

    const roots = deleted.document.rootTaskIds
    const reversed = reorderSiblingTasks(deleted.document, [...roots].reverse())
    expect(reversed.document.rootTaskIds).toEqual([...roots].reverse())
    expect(reversed.after.text).not.toBe(deleted.after.text)
    expect(() => reorderSiblingTasks(deleted.document, [roots[0], roots[0], roots[2]])).toThrow(/duplicate/i)
  })
})

describe('lineage diagnostics', () => {
  it('does not treat aggregate function names as source columns', () => {
    const analysis = analyzeSql('SELECT COUNT(*) AS event_count, MAX(e.event_time) AS last_event_time FROM analytics.events e')
    expect(analysis.outputColumns.map((column) => column.name)).toEqual(['event_count', 'last_event_time'])
  })

  it('flags unbalanced SQL structure', () => {
    const analysis = analyzeSql('SELECT (event_id FROM analytics.events')
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === 'sql-unbalanced-parentheses')).toBe(true)
  })
})

describe('SQL and schema-aware lineage', () => {
  it('extracts CTE-aware sources, targets, and output aliases', () => {
    const analysis = analyzeSql(`
      WITH recent AS (SELECT id, amount FROM analytics.events)
      INSERT INTO analytics.summary
      SELECT r.id AS user_id, SUM(r.amount) AS revenue
      FROM recent r
      JOIN analytics.profiles p ON r.id = p.id
      GROUP BY 1
    `)
    expect(analysis.sources.map((source) => source.qualifiedName)).toContain('analytics.events')
    expect(analysis.sources.map((source) => source.qualifiedName)).toContain('analytics.profiles')
    expect(analysis.sources.map((source) => source.name)).not.toContain('recent')
    expect(analysis.targets[0]?.qualifiedName).toBe('analytics.summary')
    expect(analysis.outputColumns.map((column) => column.name)).toEqual(['user_id', 'revenue'])
  })

  it('normalizes canonical databases and expands wildcard lineage with schema columns', () => {
    const schemaText = JSON.stringify({
      format: 'td-workflow-lineage-schema',
      version: 1,
      databases: [{
        name: 'analytics',
        tables: [{ name: 'events', columns: [{ name: 'id', type: 'varchar' }, { name: 'time', type: 'bigint' }] }],
      }],
    })
    const schema = parseWorkflowSchema(schemaText, 'schemas/workflow-inspector.schema.json')
    expect(schema.schema?.tables[0]?.qualifiedName).toBe('analytics.events')

    const dig = `_export:
  database: analytics
+copy:
  td>: queries/copy.sql
  create_table: copied_events
  database: \${database}
`
    const files = [
      textFile('main.dig', 'dig', dig),
      textFile('queries/copy.sql', 'sql', 'SELECT * FROM events'),
      textFile('schemas/workflow-inspector.schema.json', 'schema', schemaText),
    ]
    const archive: WorkflowArchive = {
      files,
      inputBytes: files.reduce((sum, file) => sum + file.bytes.byteLength, 0),
      expandedBytes: files.reduce((sum, file) => sum + file.bytes.byteLength, 0),
      diagnostics: [],
    }
    const analysis = analyzeWorkflow(archive)
    expect(analysis.tableLineage[0]?.source.qualifiedName).toBe('analytics.events')
    expect(analysis.tableLineage[0]?.target.qualifiedName).toBe('analytics.copied_events')
    expect(analysis.columnLineage.map((item) => item.sourceColumn)).toEqual(['id', 'time'])
  })
})
