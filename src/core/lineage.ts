import { parse as parseYaml } from 'yaml'
import { analyzeSql, parseSqlTableReference } from './sql'
import {
  parseWorkflowSchema,
  schemaColumnsForReference,
} from './schema'
import { parseDigdagDocument } from './digdag'
import { containsTemplate, expandTemplate, expandTemplateAcross } from './variables'
import type {
  ColumnLineageRecord,
  Diagnostic,
  DigdagDocument,
  DigdagTaskNode,
  PipelineEdge,
  SqlAnalysis,
  SqlConfidence,
  SqlTableReference,
  TableLineageRecord,
  VariableScope,
  WorkflowAnalysis,
  WorkflowAnalysisOptions,
  WorkflowArchive,
  WorkflowFile,
  WorkflowSchema,
  WorkflowTaskAnalysis,
} from '../types/workflow'

function isArchive(input: WorkflowArchive | ReadonlyArray<{ path: string; text: string }>): input is WorkflowArchive {
  return 'files' in input && Array.isArray(input.files)
}

function fileText(file: WorkflowFile): string | undefined {
  return file.encoding === 'utf8' ? file.text : undefined
}

function combineConfidence(...values: SqlConfidence[]): SqlConfidence {
  if (values.includes('unresolved')) return 'unresolved'
  if (values.includes('ambiguous')) return 'ambiguous'
  if (values.includes('inferred')) return 'inferred'
  return 'exact'
}

function resolveReferencePath(documentPath: string, reference: string): string | undefined {
  if (!reference || reference.includes('${') || reference.startsWith('/') || /^[A-Za-z]:[\\/]/.test(reference)) return undefined
  const base = documentPath.split('/').slice(0, -1)
  for (const part of reference.replaceAll('\\', '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (base.length === 0) return undefined
      base.pop()
    } else {
      base.push(part)
    }
  }
  return base.join('/')
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function scalar(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function taskValue(task: DigdagTaskNode, key: string): string | undefined {
  // An operator nested in an anonymous subtree carries its own configuration.
  const record = plainRecord(task.operatorConfig) ?? plainRecord(task.value)
  return scalar(record?.[key])
}

function scopesForTask(document: DigdagDocument, task: DigdagTaskNode): VariableScope[] {
  const scopes = document.taskVariables[task.id]
  return scopes && scopes.length > 0 ? scopes : [document.rootVariables]
}

function expandOne(value: string | undefined, scopes: readonly VariableScope[]): string | undefined {
  if (!value) return value
  const expansions = expandTemplateAcross(value, scopes)
  return expansions.find((expansion) => expansion.resolved)?.text ?? expansions[0]?.text ?? value
}

/**
 * Rewrites each reference once per distinct expansion, so a table written
 * inside a loop becomes one node per iteration. The original `${...}` form is
 * kept alongside so the graph can show where the name came from.
 */
function expandReferences(
  references: readonly SqlTableReference[],
  scopes: readonly VariableScope[],
): SqlTableReference[] {
  const expanded: SqlTableReference[] = []
  const byName = new Map<string, SqlTableReference>()
  for (const reference of references) {
    const raw = reference.qualifiedName
    const templated = containsTemplate(raw)
    const list = scopes.length > 0 ? scopes : [{}]
    list.forEach((scope, iteration) => {
      const expansion = expandTemplate(raw, scope)
      const key = expansion.text.toLowerCase()
      const existing = byName.get(key)
      if (existing) {
        if (templated && existing.iterations && !existing.iterations.includes(iteration)) {
          existing.iterations.push(iteration)
        }
        return
      }
      const next: SqlTableReference = {
        ...parseSqlTableReference(expansion.text, undefined, reference.location),
        ...(reference.alias ? { alias: reference.alias } : {}),
        confidence: !templated
          ? reference.confidence
          : expansion.resolved ? 'inferred' : 'unresolved',
        ...(templated ? { template: raw, iterations: [iteration] } : {}),
      }
      byName.set(key, next)
      expanded.push(next)
      if (!templated) return
    })
  }
  return expanded
}

/** A name without iterations came from no loop, so it belongs to all of them. */
function sharesIteration(left: SqlTableReference, right: SqlTableReference): boolean {
  if (!left.iterations || !right.iterations) return true
  return left.iterations.some((iteration) => right.iterations?.includes(iteration))
}

function configuredTarget(task: DigdagTaskNode): {
  operator?: 'create_table>' | 'insert_into>'
  value?: string
} {
  const createTable = taskValue(task, 'create_table')
  if (createTable) return { operator: 'create_table>', value: createTable }
  const insertInto = taskValue(task, 'insert_into')
  if (insertInto) return { operator: 'insert_into>', value: insertInto }
  return {}
}

function operatorValue(task: DigdagTaskNode, operator: string): string | undefined {
  return taskValue(task, operator)
}

function schemasFromArchive(
  archive: WorkflowArchive,
  options: WorkflowAnalysisOptions,
  diagnostics: Diagnostic[],
): WorkflowSchema[] {
  const schemas: WorkflowSchema[] = []
  const seenPaths = new Set<string>()
  for (const [path, input] of Object.entries(options.schemaFiles ?? {})) {
    const result = parseWorkflowSchema(input, path)
    diagnostics.push(...result.diagnostics)
    if (result.schema) schemas.push(result.schema)
    seenPaths.add(path)
  }
  for (const file of archive.files) {
    if (seenPaths.has(file.path) || file.kind !== 'schema') continue
    const text = fileText(file)
    if (!text) continue
    const result = parseWorkflowSchema(text, file.path)
    diagnostics.push(...result.diagnostics)
    if (result.schema) schemas.push(result.schema)
  }
  return schemas
}

function schemasFromEntries(
  entries: ReadonlyArray<{ path: string; text: string }>,
  diagnostics: Diagnostic[],
): WorkflowSchema[] {
  const schemas: WorkflowSchema[] = []
  for (const entry of entries) {
    if (!/(?:schema|\.schema)\.(?:json|ya?ml)$/i.test(entry.path)) continue
    const result = parseWorkflowSchema(entry.text, entry.path)
    diagnostics.push(...result.diagnostics)
    if (result.schema) schemas.push(result.schema)
  }
  return schemas
}

function sourceForTask(
  task: DigdagTaskNode,
  document: DigdagDocument,
  files: Map<string, WorkflowFile>,
  diagnostics: Diagnostic[],
): { sql: string; sourceFilePath?: string } | undefined {
  if (!task.sql) return undefined
  if (task.sql.kind === 'inline') {
    return task.sql.text ? { sql: task.sql.text } : undefined
  }
  if (!task.sql.path) return undefined
  const resolved = resolveReferencePath(document.path, task.sql.path)
  if (!resolved) {
    diagnostics.push({ severity: 'warning', code: 'sql-reference-invalid', message: `Could not safely resolve SQL reference ${task.sql.path}`, filePath: document.path, path: task.yamlPath })
    return undefined
  }
  const file = files.get(resolved)
  const text = file ? fileText(file) : undefined
  if (text === undefined) {
    diagnostics.push({ severity: 'warning', code: 'sql-reference-missing', message: `SQL reference not found: ${resolved}`, filePath: document.path, path: task.yamlPath })
    return undefined
  }
  return { sql: text, sourceFilePath: resolved }
}

function addConfiguredOperatorTarget(
  database: string | undefined,
  value: string | undefined,
  analysis: SqlAnalysis,
): SqlAnalysis {
  if (!value) return analysis
  const target = parseSqlTableReference(value, database)
  if (analysis.targets.some((candidate) => candidate.qualifiedName.toLowerCase() === target.qualifiedName.toLowerCase())) return analysis
  return { ...analysis, targets: [...analysis.targets, target] }
}

function taskAnalyses(
  documents: readonly DigdagDocument[],
  files: Map<string, WorkflowFile>,
  diagnostics: Diagnostic[],
): WorkflowTaskAnalysis[] {
  const analyses: WorkflowTaskAnalysis[] = []
  for (const document of documents) {
    diagnostics.push(...document.diagnostics)
    for (const task of document.tasks) {
      const scopes = scopesForTask(document, task)
      const source = sourceForTask(task, document, files, diagnostics)
      const target = configuredTarget(task)
      const database = expandOne(task.database, scopes)
      if (!source && !target.value) {
        analyses.push({ task })
        continue
      }
      const sql = analyzeSql(source?.sql ?? '', {
        database,
        ...(target.operator ? { operator: target.operator } : {}),
        ...(target.value ? { operatorValue: target.value } : {}),
      })
      const configured = addConfiguredOperatorTarget(database, target.value, sql)
      const withTarget: SqlAnalysis = {
        ...configured,
        sources: expandReferences(configured.sources, scopes),
        targets: expandReferences(configured.targets, scopes),
      }
      diagnostics.push(...withTarget.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        filePath: source?.sourceFilePath ?? document.path,
      })))
      analyses.push({
        task: database === task.database ? task : { ...task, ...(database ? { database } : {}) },
        sql: withTarget,
        ...(source?.sourceFilePath ? { sourceFilePath: source.sourceFilePath } : {}),
      })
    }
  }
  return analyses
}

function taskGroups(documents: readonly DigdagDocument[]): DigdagTaskNode[][] {
  const groups = new Map<string, DigdagTaskNode[]>()
  for (const document of documents) {
    const documentTasks = document.tasks
    for (const task of documentTasks) {
      const key = `${document.path} ${task.parentId ?? 'ROOT'}`
      const group = groups.get(key) ?? []
      group.push(task)
      groups.set(key, group)
    }
  }
  return [...groups.values()].map((group) => [...group].sort((left, right) => left.order - right.order))
}

function sequenceEdges(documents: readonly DigdagDocument[]): PipelineEdge[] {
  const edges: PipelineEdge[] = []
  const tasksById = new Map(documents.flatMap((document) => document.tasks).map((task) => [task.id, task]))
  for (const group of taskGroups(documents)) {
    const parent = group[0]?.parentId ? tasksById.get(group[0].parentId as string) : undefined
    const parentValue = parent ? plainRecord(parent.value) : undefined
    const parallel = parentValue?._parallel
    if (parallel === true || plainRecord(parallel)) continue
    for (let index = 1; index < group.length; index += 1) {
      edges.push({ from: group[index - 1].id, to: group[index].id, kind: 'sequence', confidence: 'exact' })
    }
  }
  return edges
}

function tableKey(reference: SqlTableReference): string {
  return reference.qualifiedName.toLowerCase()
}

function tableEdges(
  analyses: readonly WorkflowTaskAnalysis[],
  tableLineage: readonly TableLineageRecord[],
): PipelineEdge[] {
  const edges: PipelineEdge[] = []
  for (const producer of analyses) {
    if (!producer.sql || producer.sql.targets.length === 0) continue
    for (const consumer of analyses) {
      if (producer.task.id === consumer.task.id || !consumer.sql || consumer.sql.sources.length === 0) continue
      for (const target of producer.sql.targets) {
        for (const source of consumer.sql.sources) {
          const same = tableKey(target) === tableKey(source) ||
            (!target.database && !source.database && target.name.toLowerCase() === source.name.toLowerCase())
          if (!same) continue
          const lineage = tableLineage.find((record) => record.taskId === producer.task.id && tableKey(record.target) === tableKey(target) && tableKey(record.source) === tableKey(source))
          edges.push({
            from: producer.task.id,
            to: consumer.task.id,
            kind: 'table',
            confidence: combineConfidence(target.confidence, source.confidence, lineage?.confidence ?? 'exact'),
            table: target.qualifiedName,
          })
        }
      }
    }
  }
  return edges
}

function requireEdges(analyses: readonly WorkflowTaskAnalysis[]): PipelineEdge[] {
  const byName = new Map<string, DigdagTaskNode>()
  for (const analysis of analyses) byName.set(analysis.task.name, analysis.task)
  const edges: PipelineEdge[] = []
  for (const analysis of analyses) {
    const required = operatorValue(analysis.task, 'require>')
    if (!required) continue
    const requiredTask = byName.get(required) ?? byName.get(required.startsWith('+') ? required : `+${required}`)
    if (requiredTask) edges.push({ from: requiredTask.id, to: analysis.task.id, kind: 'require', confidence: 'exact' })
    else edges.push({ from: required, to: analysis.task.id, kind: 'require', confidence: 'unresolved' })
  }
  return edges
}

function maskExpression(expression: string): string {
  return expression.replace(/'(?:''|[^'])*'/g, ' ')
}

function sourceColumnCandidates(
  expression: string,
  sources: readonly SqlTableReference[],
): Array<{ source: SqlTableReference; column: string; confidence: SqlConfidence }> {
  const candidates: Array<{ source: SqlTableReference; column: string; confidence: SqlConfidence }> = []
  const aliases = new Map<string, SqlTableReference>()
  for (const source of sources) {
    aliases.set(source.name.toLowerCase(), source)
    if (source.alias) aliases.set(source.alias.toLowerCase(), source)
  }
  const pattern = /(?:(\w+)\s*\.\s*)?([A-Za-z_][A-Za-z0-9_$-]*)/g
  const ignored = new Set(['as', 'case', 'when', 'then', 'else', 'end', 'null', 'true', 'false', 'distinct', 'over', 'partition', 'by', 'order', 'asc', 'desc', 'and', 'or', 'not', 'is', 'like', 'in', 'cast', 'date', 'interval', 'current_date'])
  const maskedExpression = maskExpression(expression)
  for (const match of maskedExpression.matchAll(pattern)) {
    const qualifier = match[1]?.toLowerCase()
    const column = match[2]
    const matchEnd = (match.index ?? 0) + match[0].length
    const nextNonSpace = maskedExpression.slice(matchEnd).match(/^\s*(.)/)?.[1]
    if (!column || ignored.has(column.toLowerCase()) || nextNonSpace === '(') continue
    if (qualifier) {
      const source = aliases.get(qualifier)
      if (source) candidates.push({ source, column, confidence: source.confidence })
      continue
    }
    if (sources.length === 1) candidates.push({ source: sources[0], column, confidence: combineConfidence(sources[0].confidence, 'inferred') })
    else if (sources.length > 1) {
      for (const source of sources) candidates.push({ source, column, confidence: 'ambiguous' })
    }
  }
  const unique = new Map<string, { source: SqlTableReference; column: string; confidence: SqlConfidence }>()
  for (const candidate of candidates) unique.set(`${tableKey(candidate.source)}:${candidate.column.toLowerCase()}`, candidate)
  return [...unique.values()]
}

function columnLineageForTask(
  analysis: WorkflowTaskAnalysis,
  schemas: readonly WorkflowSchema[],
): ColumnLineageRecord[] {
  if (!analysis.sql || analysis.sql.targets.length === 0) return []
  const records: ColumnLineageRecord[] = []
  for (const output of analysis.sql.outputColumns) {
    const targets = analysis.sql.targets
    const targetColumns = targets.length === 1 ? targets : targets
    if (output.wildcard) {
      const wildcardSource = output.expression.match(/^\s*([A-Za-z_][A-Za-z0-9_$-]*)\s*\.\s*\*\s*$/)?.[1]?.toLowerCase()
      const sources = analysis.sql.sources.filter((source) => !wildcardSource || source.alias?.toLowerCase() === wildcardSource || source.name.toLowerCase() === wildcardSource)
      const expandedSources = sources.length > 0 ? sources : analysis.sql.sources
      const schemaColumns = expandedSources.flatMap((source) => {
        const found = schemaColumnsForReference(source, schemas)
        return found.columns.map((column) => ({ source, column, confidence: found.confidence }))
      })
      for (const target of targetColumns) {
        if (schemaColumns.length > 0) {
          for (const item of schemaColumns) {
            records.push({ sourceTable: item.source.qualifiedName, sourceColumn: item.column.name, targetTable: target.qualifiedName, targetColumn: item.column.name, taskId: analysis.task.id, confidence: combineConfidence(item.source.confidence, item.confidence, 'inferred'), wildcard: true })
          }
        } else {
          records.push({ sourceTable: expandedSources[0]?.qualifiedName, targetTable: target.qualifiedName, targetColumn: '*', taskId: analysis.task.id, confidence: 'unresolved', wildcard: true })
        }
      }
      continue
    }
    const candidates = sourceColumnCandidates(output.expression, analysis.sql.sources)
    for (const target of targetColumns) {
      if (candidates.length === 0) {
        records.push({ targetTable: target.qualifiedName, targetColumn: output.name, taskId: analysis.task.id, confidence: 'unresolved' })
      } else {
        for (const candidate of candidates) {
          records.push({ sourceTable: candidate.source.qualifiedName, sourceColumn: candidate.column, targetTable: target.qualifiedName, targetColumn: output.name, taskId: analysis.task.id, confidence: candidate.confidence })
        }
      }
    }
  }
  return records
}

function tableLineageForTask(analysis: WorkflowTaskAnalysis): TableLineageRecord[] {
  if (!analysis.sql) return []
  const records: TableLineageRecord[] = []
  for (const target of analysis.sql.targets) {
    for (const source of analysis.sql.sources) {
      if (!sharesIteration(source, target)) continue
      records.push({ source, target, taskId: analysis.task.id, confidence: combineConfidence(source.confidence, target.confidence) })
    }
  }
  return records
}

function includeResolverFor(documentPath: string, files: Map<string, WorkflowFile>): (path: string) => unknown {
  return (reference: string) => {
    const resolved = resolveReferencePath(documentPath, reference)
    const text = resolved ? files.get(resolved)?.text : undefined
    if (text === undefined) return undefined
    try {
      return parseYaml(text)
    } catch {
      return undefined
    }
  }
}

export function analyzeWorkflow(
  input: WorkflowArchive | ReadonlyArray<{ path: string; text: string }>,
  options: WorkflowAnalysisOptions = {},
): WorkflowAnalysis {
  const diagnostics: Diagnostic[] = []
  const files = new Map<string, WorkflowFile>()
  let documents: DigdagDocument[]
  let schemas: WorkflowSchema[]
  if (isArchive(input)) {
    for (const file of input.files) files.set(file.path, file)
    documents = input.files
      .filter((file) => file.kind === 'dig' && file.text !== undefined)
      .map((file) => parseDigdagDocument(file.text as string, {
        path: file.path,
        resolveInclude: includeResolverFor(file.path, files),
      }))
    schemas = schemasFromArchive(input, options, diagnostics)
    diagnostics.push(...input.diagnostics)
  } else {
    for (const entry of input) files.set(entry.path, { path: entry.path, kind: entry.path.endsWith('.sql') ? 'sql' : 'binary', encoding: 'utf8', text: entry.text, bytes: new TextEncoder().encode(entry.text) })
    documents = input
      .filter((entry) => entry.path.toLowerCase().endsWith('.dig'))
      .map((entry) => parseDigdagDocument(entry.text, {
        path: entry.path,
        resolveInclude: includeResolverFor(entry.path, files),
      }))
    schemas = schemasFromEntries(input, diagnostics)
  }

  const tasks = taskAnalyses(documents, files, diagnostics)
  const tableLineage = tasks.flatMap(tableLineageForTask)
  const columnLineage = tasks.flatMap((task) => columnLineageForTask(task, schemas))
  const edges = [
    ...sequenceEdges(documents),
    ...tableEdges(tasks, tableLineage),
    ...requireEdges(tasks),
  ]
  return { documents, schemas, tasks, tableLineage, columnLineage, edges, diagnostics }
}

export const buildWorkflowLineage = analyzeWorkflow
