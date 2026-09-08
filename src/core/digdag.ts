import {
  isMap,
  isSeq,
  parseDocument as parseYamlDocument,
} from 'yaml'
import type { Document, Pair, YAMLMap } from 'yaml'
import type {
  Diagnostic,
  DigdagDocument,
  DigdagParseOptions,
  DigdagTaskNode,
  SqlReference,
  TaskOperator,
  YamlPath,
} from '../types/workflow'

interface ExecutionContext {
  database?: string
  engine?: string
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object' && 'value' in value) {
    const scalar = value.value
    if (typeof scalar === 'string') return scalar
    if (typeof scalar === 'number' || typeof scalar === 'boolean') return String(scalar)
  }
  return undefined
}

function keyString(pair: Pair): string | undefined {
  const key = pair.key as { value?: unknown } | unknown
  if (typeof key === 'string') return key
  if (key && typeof key === 'object' && 'value' in key) return scalarString(key.value)
  return scalarString(key)
}

function nodeToJs(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toJSON' in value && typeof value.toJSON === 'function') {
    try {
      return value.toJSON()
    } catch {
      return undefined
    }
  }
  return value
}

function valueFor(map: YAMLMap, key: string): unknown {
  const pair = map.items.find((item) => keyString(item) === key)
  return pair?.value
}

function mapFor(value: unknown): YAMLMap | undefined {
  return isMap(value) ? value : undefined
}

function contextFromExport(value: unknown, inherited: ExecutionContext): ExecutionContext {
  const map = mapFor(value)
  const td = map ? mapFor(valueFor(map, 'td')) : undefined
  const database = td ? scalarString(valueFor(td, 'database')) : undefined
  const engine = td ? scalarString(valueFor(td, 'engine')) : undefined
  return {
    database: database ?? inherited.database,
    engine: engine ?? inherited.engine,
  }
}

function taskContext(body: YAMLMap, inherited: ExecutionContext): ExecutionContext {
  let context = contextFromExport(valueFor(body, '_export'), inherited)
  const localDatabase = scalarString(valueFor(body, 'database'))
  const localEngine = scalarString(valueFor(body, 'engine'))
  if (localDatabase !== undefined) context = { ...context, database: localDatabase }
  if (localEngine !== undefined) context = { ...context, engine: localEngine }

  for (const operator of ['td>', 'sql>', 'query>']) {
    const value = mapFor(valueFor(body, operator))
    if (!value) continue
    const database = scalarString(valueFor(value, 'database'))
    const engine = scalarString(valueFor(value, 'engine'))
    if (database !== undefined || engine !== undefined) {
      context = {
        database: database ?? context.database,
        engine: engine ?? context.engine,
      }
    }
  }
  return context
}

function stableTaskId(documentPath: string, names: readonly string[]): string {
  // Names rather than array indexes make IDs survive sibling reordering and reparse.
  return `task:${documentPath}:${names.join('/')}`
}

function looksLikeSql(value: string): boolean {
  return /\b(select|with|insert\s+into|create\s+table|update|delete\s+from|merge\s+into)\b/i.test(value)
}

function sqlReferenceFor(body: YAMLMap, taskPath: YamlPath): SqlReference | undefined {
  const candidates = ['td>', 'sql>', 'query>']
  for (const operator of candidates) {
    const value = valueFor(body, operator)
    const map = mapFor(value)
    if (map) {
      const text = scalarString(valueFor(map, 'query')) ??
        scalarString(valueFor(map, 'sql')) ??
        scalarString(valueFor(map, 'path'))
      if (!text) continue
      return looksLikeSql(text)
        ? { kind: 'inline', text, yamlPath: [...taskPath, operator] }
        : { kind: 'reference', path: text, yamlPath: [...taskPath, operator] }
    }
    const text = scalarString(value)
    if (!text) continue
    return looksLikeSql(text)
      ? { kind: 'inline', text, yamlPath: [...taskPath, operator] }
      : { kind: 'reference', path: text, yamlPath: [...taskPath, operator] }
  }
  return undefined
}

function operatorsFor(body: YAMLMap): TaskOperator[] {
  const operators: TaskOperator[] = []
  for (const pair of body.items) {
    const key = keyString(pair)
    if (!key) continue
    if (key.endsWith('>') || key === '_parallel' || key === 'if>' || key === 'for_each>') {
      if (!operators.includes(key)) operators.push(key)
    }
  }
  return operators
}

function addParseDiagnostics(
  document: Document.Parsed,
  path: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const error of document.errors) {
    diagnostics.push({
      severity: 'error',
      code: 'yaml-parse-error',
      message: error.message,
      filePath: path,
    })
  }
  for (const warning of document.warnings) {
    diagnostics.push({
      severity: 'warning',
      code: 'yaml-warning',
      message: warning.message,
      filePath: path,
    })
  }
  return diagnostics
}

function collectionChildren(value: unknown): Iterable<unknown> {
  if (isMap(value)) return [value]
  if (isSeq(value)) return value.items
  return []
}

export function parseDigdagDocument(
  text: string,
  options: DigdagParseOptions = {},
): DigdagDocument {
  const path = options.path ?? 'workflow.dig'
  let document: Document.Parsed
  const diagnostics: Diagnostic[] = []
  try {
    document = parseYamlDocument(text) as Document.Parsed
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to parse YAML'
    document = parseYamlDocument('{}') as Document.Parsed
    diagnostics.push({ severity: 'error', code: 'yaml-parse-error', message, filePath: path })
  }
  diagnostics.push(...addParseDiagnostics(document, path))

  const tasks: DigdagTaskNode[] = []
  const rootTaskIds: string[] = []
  const root = document.contents
  const rootMap = mapFor(root)
  if (!rootMap) {
    diagnostics.push({
      severity: 'error',
      code: 'workflow-root-not-map',
      message: 'A Digdag workflow must have a YAML mapping at its root',
      filePath: path,
    })
    return { path, text, document, tasks, rootTaskIds, diagnostics }
  }

  const rootContext = contextFromExport(valueFor(rootMap, '_export'), {})

  const visitContainer = (
    value: unknown,
    parent: DigdagTaskNode | undefined,
    parentPath: YamlPath,
    context: ExecutionContext,
    depth: number,
    names: readonly string[],
  ): void => {
    for (const collection of collectionChildren(value)) {
      const map = mapFor(collection)
      if (!map) continue
      for (const pair of map.items) {
        const name = keyString(pair)
        if (!name) continue
        if (name.startsWith('+')) {
          const taskPath = [...parentPath, name]
          const body = mapFor(pair.value)
          if (!body) {
            diagnostics.push({
              severity: 'warning',
              code: 'task-not-map',
              message: `Task ${name} should contain a YAML mapping`,
              path: taskPath,
              filePath: path,
            })
          }
          const effectiveBody = body ?? (parseYamlDocument('{}').contents as YAMLMap)
          const effectiveContext = taskContext(effectiveBody, context)
          const operators = operatorsFor(effectiveBody)
          const task: DigdagTaskNode = {
            id: stableTaskId(path, [...names, name]),
            name,
            documentPath: path,
            yamlPath: taskPath,
            ...(parent ? { parentId: parent.id } : {}),
            children: [],
            depth,
            order: tasks.length,
            ...(operators[0] ? { operator: operators[0] } : {}),
            operators,
            ...(effectiveContext.database ? { database: effectiveContext.database } : {}),
            ...(effectiveContext.engine ? { engine: effectiveContext.engine } : {}),
            ...(body ? { sql: sqlReferenceFor(body, taskPath) } : {}),
            value: nodeToJs(pair.value),
          }
          tasks.push(task)
          if (parent) parent.children.push(task.id)
          else rootTaskIds.push(task.id)

          // This intentionally walks every structural operator map. It covers
          // direct children, _do, _parallel, if>, for_each>, call>, require>,
          // and td> containers without mistaking SQL scalar text for YAML.
          if (body) visitContainer(body, task, taskPath, effectiveContext, depth + 1, [...names, name])
          continue
        }

        const isStructural = name === '_do' || name === '_parallel' || name.endsWith('>')
        if (isStructural && (isMap(pair.value) || isSeq(pair.value))) {
          visitContainer(pair.value, parent, parentPath, context, depth, names)
        }
      }
    }
  }

  visitContainer(rootMap, undefined, [], rootContext, 0, [])
  return { path, text, document, tasks, rootTaskIds, diagnostics }
}

export function reparseDigdagDocument(document: DigdagDocument, text: string): DigdagDocument {
  return parseDigdagDocument(text, { path: document.path })
}

export function serializeDigdagDocument(document: DigdagDocument): string {
  return document.document.toString()
}

export function findDigdagTask(
  document: DigdagDocument,
  taskId: string,
): DigdagTaskNode | undefined {
  return document.tasks.find((task) => task.id === taskId)
}

export function findDigdagTaskByPath(
  document: DigdagDocument,
  path: YamlPath,
): DigdagTaskNode | undefined {
  return document.tasks.find((task) =>
    task.yamlPath.length === path.length && task.yamlPath.every((part, index) => part === path[index]),
  )
}

export function parseDigdagDocuments(
  entries: ReadonlyArray<{ path: string; text: string }>,
): DigdagDocument[] {
  return entries.map((entry) => parseDigdagDocument(entry.text, { path: entry.path }))
}
