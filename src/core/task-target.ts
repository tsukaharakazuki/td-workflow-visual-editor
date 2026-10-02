import type { DigdagTaskNode } from '../types'

/** What a task card shows as the thing the task runs. */
export interface TaskExecutionTarget {
  /** The label shown on the card: a project-relative path when it is a file. */
  label: string
  /** The value exactly as written in the .dig file. */
  raw: string
  kind: 'file' | 'workflow' | 'method' | 'command' | 'query' | 'inline'
}

/** Operators whose value names a file in the project, by default extension. */
const FILE_OPERATORS: Record<string, string | undefined> = {
  'call>': '.dig',
  'td_load>': '.yml',
  'embulk>': '.yml',
  'td_for_each>': '.sql',
  'td_wait>': '.sql',
  'td_wait_table>': undefined,
  'td_ddl>': undefined,
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index)
}

/** Joins `relative` onto the directory of `fromFile`, collapsing `.` and `..`. */
export function resolveProjectPath(fromFile: string, relative: string): string {
  if (relative.includes('${')) return relative
  const parts = [...dirname(fromFile).split('/'), ...relative.split('/')]
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') resolved.pop()
      else resolved.push('..')
      continue
    }
    resolved.push(part)
  }
  return resolved.join('/')
}

function operatorValue(task: DigdagTaskNode): unknown {
  if (!task.operator) return undefined
  const config = (task.operatorConfig ?? task.value) as Record<string, unknown> | null
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined
  return config[task.operator]
}

function looksLikeFile(value: string): boolean {
  return /\.(sql|dig|ya?ml|py|sh|rb|json)$/i.test(value.trim())
}

/**
 * The file, workflow, method or command a task executes, for display on its card.
 * Returns undefined for groups and operators whose value is not something it runs.
 */
export function taskExecutionTarget(task: DigdagTaskNode): TaskExecutionTarget | undefined {
  const operator = task.operator
  if (!operator || operator === '_parallel') return undefined

  if (task.sql) {
    if (task.sql.kind === 'reference' && task.sql.path) {
      return { kind: 'file', raw: task.sql.path, label: resolveProjectPath(task.documentPath, task.sql.path) }
    }
    if (task.sql.kind === 'inline') return { kind: 'inline', raw: task.sql.text ?? '', label: 'インラインSQL' }
  }

  const value = operatorValue(task)
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const raw = value.trim()

  if (operator === 'require>') return { kind: 'workflow', raw, label: raw }
  if (operator === 'td_run>') return { kind: 'query', raw, label: raw }
  if (operator === 'py>' || operator === 'rb>') return { kind: 'method', raw, label: raw }
  if (operator === 'sh>') return { kind: 'command', raw, label: raw }

  if (operator in FILE_OPERATORS) {
    const extension = FILE_OPERATORS[operator]
    if (!extension && !looksLikeFile(raw)) return undefined
    const withExtension = extension && !looksLikeFile(raw) && !raw.includes('${') ? `${raw}${extension}` : raw
    return {
      kind: operator === 'call>' ? 'workflow' : 'file',
      raw,
      label: resolveProjectPath(task.documentPath, withExtension),
    }
  }

  if (looksLikeFile(raw)) return { kind: 'file', raw, label: resolveProjectPath(task.documentPath, raw) }
  return undefined
}
