import { isMap } from 'yaml'
import type { Document, Pair, YAMLMap } from 'yaml'
import {
  DigdagEditError,
} from '../types/workflow'
import type {
  DigdagDocument,
  DigdagEdit,
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

function plainValue(value: unknown): unknown {
  if (value && typeof value === 'object' && 'toJSON' in value && typeof value.toJSON === 'function') {
    try {
      return value.toJSON()
    } catch {
      return undefined
    }
  }
  return value
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

function taskPairAt(map: YAMLMap, name: string): Pair | undefined {
  return map.items.find((pair) => pairKey(pair) === name)
}

function siblingTaskPairs(map: YAMLMap): Pair[] {
  return map.items.filter((pair) => pairKey(pair)?.startsWith('+'))
}

function parentPath(task: DigdagTaskNode): YamlPath {
  return task.yamlPath.slice(0, -1)
}

function normalizedTaskName(name: string): string {
  return name.startsWith('+') ? name : `+${name}`
}

function siblingIndex(document: DigdagDocument, task: DigdagTaskNode): number {
  const map = mapAt(document.document, parentPath(task))
  return siblingTaskPairs(map).findIndex((pair) => pairKey(pair) === task.name)
}

function updateDocument(
  original: DigdagDocument,
  edited: Document,
  inverse: DigdagEdit,
): DigdagEditResult {
  const afterText = edited.toString()
  const reparsed = reparseDigdagDocument(original, afterText)
  return {
    document: reparsed,
    before: { path: original.path, text: original.text },
    after: { path: original.path, text: afterText },
    inverse,
  }
}

function addSiblingInternal(
  original: DigdagDocument,
  sibling: DigdagTaskNode,
  name: string,
  value: unknown,
): DigdagEditResult {
  const normalizedName = normalizedTaskName(name)
  const edited = original.document.clone()
  const map = mapAt(edited, parentPath(sibling))
  if (taskPairAt(map, normalizedName)) {
    throw new DigdagEditError('duplicate-sibling', `Sibling already exists: ${normalizedName}`)
  }
  const targetIndex = map.items.findIndex((pair) => pairKey(pair) === sibling.name)
  if (targetIndex < 0) throw new DigdagEditError('task-not-found', `Task not found: ${sibling.id}`)
  map.items.splice(targetIndex + 1, 0, edited.createPair(normalizedName, value ?? {}))
  const result = updateDocument(original, edited, { kind: 'noop' })
  const added = result.document.tasks.find((task) =>
    task.name === normalizedName && task.parentId === sibling.parentId,
  )
  if (!added) throw new DigdagEditError('edit-reparse-failed', `Could not find added task: ${normalizedName}`)
  result.inverse = { kind: 'delete-task', taskId: added.id }
  return result
}

function restoreTask(
  original: DigdagDocument,
  edit: Extract<DigdagEdit, { kind: 'restore-task' }>,
): DigdagEditResult {
  const parent = edit.parentId ? taskOrThrow(original, edit.parentId) : undefined
  const path = parent?.yamlPath ?? []
  const edited = original.document.clone()
  const map = mapAt(edited, path)
  const name = normalizedTaskName(edit.name)
  if (taskPairAt(map, name)) throw new DigdagEditError('duplicate-sibling', `Sibling already exists: ${name}`)
  const pairs = siblingTaskPairs(map)
  const index = Math.max(0, Math.min(edit.index, pairs.length))
  const insertionAfter = index === 0
    ? -1
    : map.items.findIndex((pair) => pair === pairs[index - 1])
  map.items.splice(insertionAfter + 1, 0, edited.createPair(name, edit.value ?? {}))
  const result = updateDocument(original, edited, { kind: 'delete-task', taskId: `task:${original.path}:${name}` })
  const restored = result.document.tasks.find((task) => task.name === name && task.parentId === edit.parentId)
  if (!restored) throw new DigdagEditError('edit-reparse-failed', `Could not restore task: ${name}`)
  result.inverse = { kind: 'delete-task', taskId: restored.id }
  return result
}

function deleteTaskInternal(original: DigdagDocument, task: DigdagTaskNode): DigdagEditResult {
  const index = siblingIndex(original, task)
  if (index < 0) throw new DigdagEditError('task-not-found', `Task not found: ${task.id}`)
  const edited = original.document.clone()
  if (!edited.deleteIn(task.yamlPath)) throw new DigdagEditError('task-not-found', `Task not found: ${task.id}`)
  return updateDocument(original, edited, {
    kind: 'restore-task',
    ...(task.parentId ? { parentId: task.parentId } : {}),
    name: task.name,
    value: plainValue(task.value),
    index,
  })
}

function reorderTasksInternal(original: DigdagDocument, taskIds: readonly string[]): DigdagEditResult {
  if (taskIds.length === 0) throw new DigdagEditError('empty-order', 'At least one task is required to reorder')
  const tasks = taskIds.map((taskId) => taskOrThrow(original, taskId))
  const parent = tasks[0].parentId
  if (!tasks.every((task) => task.parentId === parent)) {
    throw new DigdagEditError('different-parents', 'Only sibling tasks can be reordered together')
  }
  const edited = original.document.clone()
  const sourceMap = mapAt(original.document, parentPath(tasks[0]))
  const map = mapAt(edited, parentPath(tasks[0]))
  const existing = siblingTaskPairs(sourceMap)
  const allSiblingIds = original.tasks
    .filter((task) => task.parentId === parent)
    .sort((left, right) => left.order - right.order)
    .map((task) => task.id)
  if (taskIds.length !== allSiblingIds.length || taskIds.some((id) => !allSiblingIds.includes(id))) {
    throw new DigdagEditError('incomplete-order', 'Reorder must include every sibling task')
  }
  const pairById = new Map<string, Pair>()
  for (const pair of existing) {
    const task = tasks.find((candidate) => candidate.name === pairKey(pair))
    if (task) pairById.set(task.id, pair)
  }
  const reordered = taskIds.map((id) => pairById.get(id)).filter((pair): pair is Pair => pair !== undefined)
  let taskIndex = 0
  for (let index = 0; index < map.items.length; index += 1) {
    if (pairKey(map.items[index])?.startsWith('+')) {
      map.items[index] = reordered[taskIndex]
      taskIndex += 1
    }
  }
  return updateDocument(original, edited, { kind: 'restore-reorder', taskIds: allSiblingIds })
}

export function applyDigdagEdit(document: DigdagDocument, edit: DigdagEdit): DigdagEditResult {
  switch (edit.kind) {
    case 'add-sibling':
      return addSiblingInternal(document, taskOrThrow(document, edit.siblingId), edit.name, edit.value)
    case 'delete-task':
      return deleteTaskInternal(document, taskOrThrow(document, edit.taskId))
    case 'reorder-siblings':
      return reorderTasksInternal(document, edit.taskIds)
    case 'restore-task':
      return restoreTask(document, edit)
    case 'restore-reorder': {
      const result = reorderTasks(document, edit.taskIds)
      result.inverse = { kind: 'restore-reorder', taskIds: edit.taskIds }
      return result
    }
    case 'noop':
      return updateDocument(document, document.document.clone(), { kind: 'noop' })
  }
}

export function addSiblingTask(
  document: DigdagDocument,
  siblingId: string,
  name: string,
  value: unknown = {},
): DigdagEditResult {
  return applyDigdagEdit(document, { kind: 'add-sibling', siblingId, name, value })
}

export function deleteDigdagTask(document: DigdagDocument, taskId: string): DigdagEditResult {
  return applyDigdagEdit(document, { kind: 'delete-task', taskId })
}

export function reorderSiblingTasks(document: DigdagDocument, taskIds: string[]): DigdagEditResult {
  return applyDigdagEdit(document, { kind: 'reorder-siblings', taskIds })
}

export const addSibling = addSiblingTask
export const deleteTask = deleteDigdagTask
export const reorderTasks = reorderSiblingTasks
