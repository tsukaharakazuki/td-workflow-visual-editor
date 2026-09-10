import { isMap, isScalar, Scalar } from 'yaml'
import type { Document, Pair, YAMLMap } from 'yaml'
import { DigdagEditError } from '../types/workflow'
import type {
  DigdagDocument,
  DigdagEditResult,
  DigdagTaskNode,
  YamlPath,
} from '../types/workflow'
import { findDigdagTask, reparseDigdagDocument } from './digdag'

function pairKey(pair: Pair): string | undefined {
  const key = pair.key as { value?: unknown } | unknown
  if (typeof key === 'string') return key
  if (key && typeof key === 'object' && 'value' in key) {
    return typeof key.value === 'string' ? key.value : undefined
  }
  return undefined
}

function taskOrThrow(document: DigdagDocument, taskId: string): DigdagTaskNode {
  const task = findDigdagTask(document, taskId)
  if (!task) throw new DigdagEditError('task-not-found', `Task not found: ${taskId}`)
  return task
}

function mapAt(document: Document, path: YamlPath): YAMLMap {
  const value = path.length === 0 ? document.contents : document.getIn(path, true)
  if (!isMap(value)) throw new DigdagEditError('parent-not-map', `YAML path is not a mapping: ${path.join('.')}`)
  return value
}

function resultFor(original: DigdagDocument, edited: Document): DigdagEditResult {
  const text = edited.toString()
  return {
    document: reparseDigdagDocument(original, text),
    before: { path: original.path, text: original.text },
    after: { path: original.path, text },
    inverse: { kind: 'noop' },
  }
}

function normalizedTaskName(name: string): string {
  const trimmed = name.trim()
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`
}

/**
 * Where the task's operator and its settings live. For most tasks that is the
 * task body; for a task whose operator sits in an anonymous `_do` subtree it is
 * that subtree's map, which is what `sql.yamlPath` points into.
 */
function operatorBodyPath(task: DigdagTaskNode): YamlPath {
  return task.sql?.yamlPath ? task.sql.yamlPath.slice(0, -1) : task.yamlPath
}

export function renameDigdagTask(
  document: DigdagDocument,
  taskId: string,
  name: string,
): DigdagEditResult {
  const task = taskOrThrow(document, taskId)
  const normalized = normalizedTaskName(name)
  if (normalized === '+') throw new DigdagEditError('task-name-empty', 'Task name cannot be empty')
  if (/\s/.test(normalized)) throw new DigdagEditError('task-name-invalid', 'Task name cannot contain spaces')
  if (normalized === task.name) return resultFor(document, document.document.clone())

  const edited = document.document.clone()
  const container = mapAt(edited, task.yamlPath.slice(0, -1))
  if (container.items.some((pair) => pairKey(pair) === normalized)) {
    throw new DigdagEditError('duplicate-sibling', `Sibling already exists: ${normalized}`)
  }
  const pair = container.items.find((item) => pairKey(item) === task.name)
  if (!pair) throw new DigdagEditError('task-not-found', `Task not found: ${task.id}`)
  // Renaming the key in place keeps the body node, and its comments, untouched.
  if (isScalar(pair.key)) pair.key.value = normalized
  else pair.key = edited.createNode(normalized)
  return resultFor(document, edited)
}

/**
 * Sets or clears plain scalar settings such as `database` and `engine`. An
 * empty value removes the key so the task falls back to what it inherits.
 */
export function setDigdagTaskFields(
  document: DigdagDocument,
  taskId: string,
  fields: Readonly<Record<string, string | undefined>>,
): DigdagEditResult {
  const task = taskOrThrow(document, taskId)
  const edited = document.document.clone()
  const body = mapAt(edited, operatorBodyPath(task))
  for (const [key, value] of Object.entries(fields)) {
    const trimmed = value?.trim()
    if (trimmed) body.set(key, trimmed)
    else body.delete(key)
  }
  return resultFor(document, edited)
}

function asBlockScalar(node: Scalar, sql: string): void {
  node.value = sql
  node.type = sql.includes('\n') ? Scalar.BLOCK_LITERAL : Scalar.PLAIN
}

/**
 * Rewrites a task's inline query, in whichever of the three shapes Digdag
 * allows: a scalar on the operator key, a `query` inside the operator map, or a
 * `query` sibling of an empty operator key. A task that points at a `.sql` file
 * is not edited here — that file is edited on its own.
 */
export function setDigdagTaskQuery(
  document: DigdagDocument,
  taskId: string,
  sql: string,
): DigdagEditResult {
  const task = taskOrThrow(document, taskId)
  if (!task.sql) throw new DigdagEditError('task-has-no-sql', `Task has no query: ${task.name}`)
  if (task.sql.kind === 'reference') {
    throw new DigdagEditError('task-sql-is-a-file', 'This task reads its query from a file')
  }
  const path = task.sql.yamlPath
  if (!path) throw new DigdagEditError('task-has-no-sql', `Task has no query: ${task.name}`)

  const edited = document.document.clone()
  const node = edited.getIn(path, true)
  if (isMap(node)) {
    const key = node.has('query') ? 'query' : node.has('sql') ? 'sql' : 'query'
    const existing = node.get(key, true)
    if (isScalar(existing)) asBlockScalar(existing, sql)
    else node.set(key, edited.createNode(sql))
    return resultFor(document, edited)
  }
  if (isScalar(node) && node.value !== null && node.value !== '') {
    asBlockScalar(node, sql)
    return resultFor(document, edited)
  }
  // An empty operator key carries its query in a sibling of the same map.
  const body = mapAt(edited, path.slice(0, -1))
  const key = body.has('query') ? 'query' : body.has('sql') ? 'sql' : 'query'
  const existing = body.get(key, true)
  if (isScalar(existing)) asBlockScalar(existing, sql)
  else body.set(key, edited.createNode(sql))
  return resultFor(document, edited)
}
