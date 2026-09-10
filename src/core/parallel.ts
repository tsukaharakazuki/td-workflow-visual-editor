import { isMap } from 'yaml'
import type { Document, Pair, YAMLMap } from 'yaml'
import { DigdagEditError } from '../types/workflow'
import type {
  DigdagDocument,
  DigdagEditResult,
  DigdagParallelSettings,
  DigdagTaskNode,
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

function taskBody(document: Document, task: DigdagTaskNode): YAMLMap {
  const body = document.getIn(task.yamlPath, true)
  if (!isMap(body)) throw new DigdagEditError('task-not-map', `Task is not a mapping: ${task.name}`)
  return body
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
  return name.startsWith('+') ? name : `+${name}`
}

export function parallelSettingsForTask(task: DigdagTaskNode): DigdagParallelSettings {
  if (!task.value || typeof task.value !== 'object' || Array.isArray(task.value)) return { enabled: false }
  const value = (task.value as Record<string, unknown>)._parallel
  if (value === true) return { enabled: true }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { enabled: false }
  const config = value as Record<string, unknown>
  return {
    enabled: true,
    ...(typeof config.limit === 'number' && Number.isInteger(config.limit) && config.limit > 0 ? { limit: config.limit } : {}),
    ...(config.eager === true ? { eager: true } : {}),
  }
}

export function setTaskParallel(
  document: DigdagDocument,
  taskId: string,
  settings: DigdagParallelSettings,
): DigdagEditResult {
  const task = taskOrThrow(document, taskId)
  const edited = document.document.clone()
  const editedTask = taskBody(edited, task)

  if (!settings.enabled) {
    editedTask.delete('_parallel')
    return resultFor(document, edited)
  }
  if (settings.limit !== undefined && (!Number.isInteger(settings.limit) || settings.limit < 1)) {
    throw new DigdagEditError('parallel-limit-invalid', 'Parallel limit must be a positive integer')
  }

  if (settings.limit === undefined && !settings.eager) {
    editedTask.set('_parallel', true)
  } else {
    editedTask.set('_parallel', {
      ...(settings.limit !== undefined ? { limit: settings.limit } : {}),
      ...(settings.eager ? { eager: true } : {}),
    })
  }
  return resultFor(document, edited)
}

export function addChildTask(
  document: DigdagDocument,
  parentId: string,
  name: string,
  value: unknown = {},
): DigdagEditResult {
  const parent = taskOrThrow(document, parentId)
  const edited = document.document.clone()
  const editedParent = taskBody(edited, parent)
  const normalizedName = normalizedTaskName(name)
  if (editedParent.items.some((pair) => pairKey(pair) === normalizedName)) {
    throw new DigdagEditError('duplicate-child', `Child already exists: ${normalizedName}`)
  }
  editedParent.add(edited.createPair(normalizedName, value ?? {}))
  return resultFor(document, edited)
}
