import { useEffect, useMemo, useRef, useState } from 'react'
import { Pencil, Variable, X } from 'lucide-react'
import { ExportEditor } from './ExportEditor'
import type { DigdagDocument } from '../types'

/**
 * The `_export` block at the top of a .dig file — the variables every task in
 * the workflow inherits. Separate from a task's own `_export`, which only
 * reaches that task and its children.
 */
export function WorkflowExportDialog({
  document,
  onSave,
  onClose,
}: {
  document: DigdagDocument
  onSave: (variables: Record<string, unknown>) => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // The parsed root `_export`, read straight from the document rather than from
  // rootVariables, which also carries values merged in from `!include`.
  const declared = useMemo(() => {
    const root = document.document.toJS() as Record<string, unknown> | null
    const value = root?._export
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  }, [document])

  const timezone = useMemo(() => {
    const root = document.document.toJS() as Record<string, unknown> | null
    return typeof root?.timezone === 'string' ? root.timezone : undefined
  }, [document])

  const inherited = Object.entries(document.rootVariables ?? {})
    .filter(([key]) => !(declared && key in declared))

  return (
    <div
      className="release-log-overlay"
      role="presentation"
      onMouseDown={(event) => { if (!panelRef.current?.contains(event.target as Node)) onClose() }}
    >
      <div className="release-log-panel workflow-export-panel" role="dialog" aria-modal="true" aria-label="ワークフローの変数" ref={panelRef}>
        <header>
          <span><Variable size={17} /></span>
          <div>
            <p>ワークフローの _export</p>
            <h2>{document.path}</h2>
          </div>
          <div className="inspector-header-actions">
            <button
              className={`icon-button ${editing ? 'is-editing' : ''}`}
              type="button"
              role="switch"
              aria-checked={editing}
              title={editing ? '編集モードを終了' : '編集モードにする'}
              onClick={() => setEditing((value) => !value)}
            >
              <Pencil size={16} />
            </button>
            <button className="icon-button" type="button" aria-label="閉じる" ref={closeRef} onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>
        <div className="release-log-scroll">
          {timezone && (
            <section className="property-section">
              <h3>timezone</h3>
              <dl className="property-list"><div><dt>タイムゾーン</dt><dd>{timezone}</dd></div></dl>
            </section>
          )}
          <section className="property-section">
            <h3>このファイルで定義された変数</h3>
            <ExportEditor
              variables={declared}
              editing={editing}
              onSave={onSave}
              scopeHelp="このワークフローの全タスクに渡る変数です。タスク側の _export が同じ名前を持つ場合はそちらが優先されます。"
            />
          </section>
          {inherited.length > 0 && (
            <section className="property-section">
              <h3>`!include` から取り込まれた変数</h3>
              <dl className="property-list">
                {inherited.map(([key, value]) => (
                  <div key={key}>
                    <dt><code>{key}</code></dt>
                    <dd>{typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value)}</dd>
                  </div>
                ))}
              </dl>
              <p className="operator-field-help">取り込み元のファイルで編集してください。</p>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
