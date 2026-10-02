import { describe, expect, it } from 'vitest'
import { parseDigdagDocument } from './index'
import { resolveProjectPath, taskExecutionTarget } from './task-target'

function targets(path: string, text: string) {
  const document = parseDigdagDocument(text, { path })
  return Object.fromEntries(document.tasks.map((task) => [task.name, taskExecutionTarget(task)?.label]))
}

describe('taskExecutionTarget', () => {
  it('shows the SQL file, resolved against the .dig that runs it', () => {
    expect(targets('tasks/finalize.dig', '+audit:\n  td>: ../queries/transform.sql\n')).toEqual({
      '+audit': 'queries/transform.sql',
    })
    expect(targets('main.dig', '+extract:\n  td>: queries/extract.sql\n  create_table: t\n')).toEqual({
      '+extract': 'queries/extract.sql',
    })
  })

  it('names called workflows with their .dig extension', () => {
    expect(targets('main.dig', '+publish:\n  call>: tasks/finalize\n')).toEqual({ '+publish': 'tasks/finalize.dig' })
  })

  it('shows scripts, commands and inline SQL', () => {
    const labels = targets('main.dig', [
      '+py:',
      '  py>: scripts.export.run',
      '+sh:',
      '  sh>: scripts/cleanup.sh',
      '+inline:',
      '  td>:',
      '  query: select 1',
      '+echo:',
      '  echo>: hello',
      '+group:',
      '  +child:',
      '    echo>: hi',
      '',
    ].join('\n'))
    expect(labels['+py']).toBe('scripts.export.run')
    expect(labels['+sh']).toBe('scripts/cleanup.sh')
    expect(labels['+inline']).toBe('インラインSQL')
    expect(labels['+echo']).toBeUndefined()
    expect(labels['+group']).toBeUndefined()
  })

  it('keeps templated paths as written', () => {
    expect(resolveProjectPath('tasks/a.dig', 'queries/${name}.sql')).toBe('queries/${name}.sql')
    expect(resolveProjectPath('a/b/c.dig', '../../x.sql')).toBe('x.sql')
  })
})
