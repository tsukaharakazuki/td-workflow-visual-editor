import { describe, expect, test } from 'vitest'
import { parseDigdagDocument } from './digdag'
import { addSiblingTask, deleteDigdagTask } from './edit'
import { addChildTask } from './parallel'

/**
 * Tasks nested under `_do` / `for_each>` / `_parallel` used to report a path
 * that skipped those keys, so every edit on them failed to find the node.
 */
const WORKFLOW = `
+for_each_proc:
  for_each>:
    params: \${Object.keys(set)}
  _do:
    +init:
      for_each>:
        table:
          - first
          - second
      _parallel: true
      _do:
        +init:
          +create_if_not_exists:
            td>:
            query: create table if not exists \${table}
          +delete_if_records_exists:
            td>:
            query: delete from \${table}
    +store_history:
      td>: |
        insert into history select 1
`

const document = parseDigdagDocument(WORKFLOW, { path: 'main.dig' })
const taskNamed = (name: string, depth: number) =>
  document.tasks.find((task) => task.name === name && task.depth === depth)

describe('yamlPath', () => {
  test('keeps the structural keys a nested task sits under', () => {
    expect(taskNamed('+init', 1)?.yamlPath).toEqual(['+for_each_proc', '_do', '+init'])
    expect(taskNamed('+init', 2)?.yamlPath).toEqual(['+for_each_proc', '_do', '+init', '_do', '+init'])
    expect(taskNamed('+create_if_not_exists', 3)?.yamlPath)
      .toEqual(['+for_each_proc', '_do', '+init', '_do', '+init', '+create_if_not_exists'])
  })
})

describe('editing a nested task', () => {
  test('adds a sibling to the last task of a branch', () => {
    const last = taskNamed('+delete_if_records_exists', 3)
    const result = addSiblingTask(document, last?.id ?? '', 'extra', { 'echo>': 'extra' })
    expect(result.after.text).toContain('+extra')
    expect(result.document.tasks.some((task) => task.name === '+extra' && task.depth === 3)).toBe(true)
  })

  test('adds a child inside the _do of a loop rather than beside the loop', () => {
    const loop = taskNamed('+init', 1)
    const result = addChildTask(document, loop?.id ?? '', 'extra', { 'echo>': 'extra' })
    const added = result.document.tasks.find((task) => task.name === '+extra')
    expect(added?.yamlPath).toEqual(['+for_each_proc', '_do', '+init', '_do', '+extra'])
    // The loop keeps driving its children; the new task did not land beside it.
    expect(result.after.text).toMatch(/_do:[\s\S]*\+extra/)
  })

  test('deletes a nested task', () => {
    const target = taskNamed('+store_history', 1)
    const result = deleteDigdagTask(document, target?.id ?? '')
    expect(result.after.text).not.toContain('+store_history')
  })
})
