import {
  isMap,
  isSeq,
  parseDocument as parseYamlDocument,
} from 'yaml'
import type { Document, Pair, YAMLMap } from 'yaml'
import { evaluateExpression, expandTemplate } from './variables'
import type {
  Diagnostic,
  DigdagDocument,
  DigdagParseOptions,
  DigdagTaskNode,
  SqlReference,
  TaskOperator,
  VariableScope,
  YamlPath,
} from '../types/workflow'

/** A loop can expand a task into many table names; cap the blast radius. */
const MAX_SCOPES = 64
const OPERATOR_KEYS = ['td>', 'sql>', 'query>'] as const

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

/**
 * `!include : path` loses its tag during YAML parsing — it survives only as a
 * null key — so the original text decides whether a pair is an include.
 */
function includePathFor(pair: Pair, text: string): string | undefined {
  const key = pair.key as { value?: unknown; range?: readonly number[] } | undefined
  if (!key) return undefined
  if (key.value !== null && key.value !== undefined && key.value !== '') return undefined
  const start = key.range?.[0]
  if (start === undefined) return undefined
  if (!/!include\s*$/.test(text.slice(Math.max(0, start - 40), start))) return undefined
  return scalarString(pair.value)
}

function scopeFromExport(
  value: unknown,
  text: string,
  resolveInclude?: (path: string) => unknown,
): VariableScope {
  const map = mapFor(value)
  if (!map) return {}
  const scope: VariableScope = {}
  for (const pair of map.items) {
    const includePath = includePathFor(pair, text)
    if (includePath !== undefined) {
      const loaded = resolveInclude?.(includePath)
      if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
        Object.assign(scope, loaded as VariableScope)
      }
      continue
    }
    const key = keyString(pair)
    if (!key) continue
    scope[key] = nodeToJs(pair.value)
  }
  return scope
}

function mergeScope(scopes: readonly VariableScope[], added: VariableScope): VariableScope[] {
  if (Object.keys(added).length === 0) return [...scopes]
  return scopes.map((scope) => ({ ...scope, ...added }))
}

function loopValues(value: unknown, scope: VariableScope): unknown[] {
  if (isSeq(value)) {
    return value.items.map((item) => {
      const plain = nodeToJs(item)
      return typeof plain === 'string' ? expandTemplate(plain, scope).text : plain
    })
  }
  const text = scalarString(value)
  const single = text?.trim().match(/^\$\{([^{}]*)\}$/)
  if (!single) return []
  const evaluated = evaluateExpression(single[1], scope)
  return Array.isArray(evaluated) ? evaluated : []
}

/** One scope per loop iteration, so each iteration's table names expand on their own. */
function expandForEach(map: YAMLMap, scopes: readonly VariableScope[]): VariableScope[] {
  const expanded: VariableScope[] = []
  for (const scope of scopes) {
    let current: VariableScope[] = [scope]
    for (const pair of map.items) {
      const key = keyString(pair)
      if (!key) continue
      const next: VariableScope[] = []
      for (const item of current) {
        const values = loopValues(pair.value, item)
        // An unresolvable list leaves the scope alone rather than dropping it.
        if (values.length === 0) next.push(item)
        else values.forEach((value) => next.push({ ...item, [key]: value }))
      }
      current = next
    }
    expanded.push(...current)
    if (expanded.length >= MAX_SCOPES) break
  }
  return expanded.slice(0, MAX_SCOPES)
}

function scopesForLevel(
  map: YAMLMap,
  scopes: readonly VariableScope[],
  text: string,
  resolveInclude?: (path: string) => unknown,
): VariableScope[] {
  let result = mergeScope(scopes, scopeFromExport(valueFor(map, '_export'), text, resolveInclude))
  const forEach = mapFor(valueFor(map, 'for_each>'))
  if (forEach) result = expandForEach(forEach, result)
  return result
}

function hasOperator(map: YAMLMap): boolean {
  return map.items.some((pair) => {
    const key = keyString(pair)
    return key !== undefined && (OPERATOR_KEYS as readonly string[]).includes(key)
  })
}

function containsTask(map: YAMLMap): boolean {
  return map.items.some((pair) => keyString(pair)?.startsWith('+') === true)
}

/**
 * Digdag lets a named task keep its real work in an anonymous `_do` /
 * `for_each>` subtree. Such a subtree belongs to the nearest named task, so its
 * operator and its loop scopes are reported as that task's.
 */
function inlineOperatorBody(
  body: YAMLMap,
  scopes: readonly VariableScope[],
  path: YamlPath,
  text: string,
  resolveInclude?: (path: string) => unknown,
): { map: YAMLMap; scopes: VariableScope[]; path: YamlPath } | undefined {
  const queue: Array<{ map: YAMLMap; scopes: VariableScope[]; path: YamlPath }> = [
    { map: body, scopes: [...scopes], path },
  ]
  while (queue.length > 0) {
    const current = queue.shift() as { map: YAMLMap; scopes: VariableScope[]; path: YamlPath }
    if (current.map !== body) {
      if (containsTask(current.map)) continue
      if (hasOperator(current.map)) return current
    }
    const levelScopes = current.map === body
      ? current.scopes
      : scopesForLevel(current.map, current.scopes, text, resolveInclude)
    for (const pair of current.map.items) {
      const key = keyString(pair)
      if (!key || key.startsWith('+')) continue
      if (key !== '_do' && key !== '_parallel' && !key.endsWith('>')) continue
      for (const child of pathedChildren(pair.value, [...current.path, key])) {
        const childMap = mapFor(child.value)
        if (childMap) queue.push({ map: childMap, scopes: levelScopes, path: child.path })
      }
    }
  }
  return undefined
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
    if (!text) {
      // `td>:` left empty with a sibling `query:` is a common Digdag shape.
      const sibling = scalarString(valueFor(body, 'query')) ?? scalarString(valueFor(body, 'sql'))
      if (!sibling) continue
      return looksLikeSql(sibling)
        ? { kind: 'inline', text: sibling, yamlPath: [...taskPath, operator] }
        : { kind: 'reference', path: sibling, yamlPath: [...taskPath, operator] }
    }
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

/**
 * The children of a structural node, each with its own YAML path. A sequence
 * contributes an index to the path, which `Document.getIn` needs to find the
 * node again.
 */
function pathedChildren(value: unknown, path: YamlPath): Array<{ value: unknown; path: YamlPath }> {
  if (isMap(value)) return [{ value, path }]
  if (isSeq(value)) return value.items.map((item, index) => ({ value: item, path: [...path, index] }))
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
  const taskVariables: Record<string, VariableScope[]> = {}
  const root = document.contents
  const rootMap = mapFor(root)
  if (!rootMap) {
    diagnostics.push({
      severity: 'error',
      code: 'workflow-root-not-map',
      message: 'A Digdag workflow must have a YAML mapping at its root',
      filePath: path,
    })
    return { path, text, document, tasks, rootTaskIds, diagnostics, rootVariables: {}, taskVariables }
  }

  const rootContext = contextFromExport(valueFor(rootMap, '_export'), {})
  const rootVariables = scopeFromExport(valueFor(rootMap, '_export'), text, options.resolveInclude)

  const visitContainer = (
    value: unknown,
    parent: DigdagTaskNode | undefined,
    parentPath: YamlPath,
    context: ExecutionContext,
    depth: number,
    names: readonly string[],
    scopes: readonly VariableScope[],
  ): void => {
    for (const collection of pathedChildren(value, parentPath)) {
      const map = mapFor(collection.value)
      if (!map) continue
      const levelScopes = scopesForLevel(map, scopes, text, options.resolveInclude)
      for (const pair of map.items) {
        const name = keyString(pair)
        if (!name) continue
        if (name.startsWith('+')) {
          // The path keeps every structural key, so editing can find the node.
          const taskPath = [...collection.path, name]
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
          const bodyScopes = mergeScope(
            levelScopes,
            scopeFromExport(valueFor(effectiveBody, '_export'), text, options.resolveInclude),
          )
          // A task whose operator lives in an anonymous subtree reports that
          // subtree's operator and the scopes the loops there put it under.
          const inline = hasOperator(effectiveBody)
            ? undefined
            : inlineOperatorBody(effectiveBody, bodyScopes, taskPath, text, options.resolveInclude)
          const operatorBody = inline?.map ?? effectiveBody
          const operatorPath = inline?.path ?? taskPath
          const taskScopes = inline?.scopes ?? bodyScopes
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
            ...(body ? { sql: sqlReferenceFor(operatorBody, operatorPath) } : {}),
            value: nodeToJs(pair.value),
            ...(inline ? { operatorConfig: nodeToJs(inline.map) } : {}),
          }
          taskVariables[task.id] = taskScopes
          tasks.push(task)
          if (parent) parent.children.push(task.id)
          else rootTaskIds.push(task.id)

          // This intentionally walks every structural operator map. It covers
          // direct children, _do, _parallel, if>, for_each>, call>, require>,
          // and td> containers without mistaking SQL scalar text for YAML.
          if (body) visitContainer(body, task, taskPath, effectiveContext, depth + 1, [...names, name], bodyScopes)
          continue
        }

        const isStructural = name === '_do' || name === '_parallel' || name.endsWith('>')
        if (isStructural && (isMap(pair.value) || isSeq(pair.value))) {
          visitContainer(pair.value, parent, [...collection.path, name], context, depth, names, levelScopes)
        }
      }
    }
  }

  visitContainer(rootMap, undefined, [], rootContext, 0, [], [rootVariables])
  return { path, text, document, tasks, rootTaskIds, diagnostics, rootVariables, taskVariables }
}

export function reparseDigdagDocument(
  document: DigdagDocument,
  text: string,
  options: Omit<DigdagParseOptions, 'path'> = {},
): DigdagDocument {
  return parseDigdagDocument(text, { ...options, path: document.path })
}

export function serializeDigdagDocument(document: DigdagDocument): string {
  return document.document.toString()
}

/**
 * Where a task's subtasks belong. A task that drives its children through
 * `_do` (a loop or a conditional) keeps them there rather than in its own body.
 */
export function digdagChildContainer(body: YAMLMap): YAMLMap {
  const doValue = mapFor(valueFor(body, '_do'))
  return doValue ?? body
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
  options: Omit<DigdagParseOptions, 'path'> = {},
): DigdagDocument[] {
  return entries.map((entry) => parseDigdagDocument(entry.text, { ...options, path: entry.path }))
}
