import { describe, expect, it } from 'vitest'
import {
  addChildTask,
  analyzeWorkflow,
  parallelSettingsForTask,
  parseDigdagDocument,
  setTaskParallel,
} from './index'

const workflow = `+before:
  echo>: before

+group:
  +first:
    echo>: first
  +second:
    echo>: second

+after:
  echo>: after
`

describe('parallel task editing', () => {
  it('enables, configures, and removes _parallel on a group', () => {
    const document = parseDigdagDocument(workflow, { path: 'main.dig' })
    const group = document.tasks.find((task) => task.name === '+group')
    expect(group).toBeDefined()

    const enabled = setTaskParallel(document, group!.id, { enabled: true })
    const enabledGroup = enabled.document.tasks.find((task) => task.name === '+group')
    expect(parallelSettingsForTask(enabledGroup!)).toEqual({ enabled: true })
    expect(enabled.after.text).toContain('_parallel: true')

    const limited = setTaskParallel(enabled.document, enabledGroup!.id, { enabled: true, limit: 2, eager: true })
    const limitedGroup = limited.document.tasks.find((task) => task.name === '+group')
    expect(parallelSettingsForTask(limitedGroup!)).toEqual({ enabled: true, limit: 2, eager: true })
    expect(limited.after.text).toContain('limit: 2')
    expect(limited.after.text).toContain('eager: true')

    const disabled = setTaskParallel(limited.document, limitedGroup!.id, { enabled: false })
    expect(disabled.after.text).not.toContain('_parallel')
  })

  it('adds a task inside a selected parallel group', () => {
    const document = parseDigdagDocument(workflow, { path: 'main.dig' })
    const group = document.tasks.find((task) => task.name === '+group')
    const parallel = setTaskParallel(document, group!.id, { enabled: true })
    const result = addChildTask(parallel.document, group!.id, 'third', { 'echo>': 'third' })
    const added = result.document.tasks.find((task) => task.name === '+third')

    expect(added?.parentId).toBe(group!.id)
    expect(result.after.text).toContain('+third:')
  })

  it('does not create sequence edges between limited parallel children', () => {
    const document = parseDigdagDocument(workflow, { path: 'main.dig' })
    const group = document.tasks.find((task) => task.name === '+group')
    const limited = setTaskParallel(document, group!.id, { enabled: true, limit: 2, eager: true })
    const analysis = analyzeWorkflow([{ path: 'main.dig', text: limited.after.text }])
    const childIds = limited.document.tasks.filter((task) => task.parentId === group!.id).map((task) => task.id)

    expect(analysis.edges.some((edge) => edge.kind === 'sequence' && childIds.includes(edge.from) && childIds.includes(edge.to))).toBe(false)
  })
})
