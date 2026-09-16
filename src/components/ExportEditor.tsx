import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Variable } from 'lucide-react'

interface ExportEditorProps {
  /** The `_export` block as parsed, or undefined when the block is absent. */
  variables: Record<string, unknown> | undefined
  editing: boolean
  /** Called with the whole block; an empty object removes `_export`. */
  onSave: (variables: Record<string, unknown>) => void
  /** Where these variables apply, shown as help text. */
  scopeHelp: string
  /** Values `${...}` actually resolves to here, when the analysis knows them. */
  resolved?: Record<string, unknown>
}

interface Row {
  id: number
  key: string
  /** The value as text. Numbers and booleans are recognised on save. */
  text: string
  /** Set for values that are not scalars; those are edited as JSON. */
  structured: boolean
}

function valueToText(value: unknown): { text: string; structured: boolean } {
  if (value === null) return { text: '', structured: false }
  if (typeof value === 'object') return { text: JSON.stringify(value), structured: true }
  return { text: String(value), structured: false }
}

/**
 * Turns the typed text back into a YAML value. Digdag treats `_export` values
 * as real YAML, so `3` must stay a number and `true` a boolean — quoting them
 * would change what `${...}` expands to.
 */
function textToValue(text: string, structured: boolean): unknown {
  const trimmed = text.trim()
  if (structured) {
    try { return JSON.parse(trimmed) } catch { return trimmed }
  }
  if (trimmed === '') return ''
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed)
  if (/^-?\d*\.\d+$/.test(trimmed)) return Number(trimmed)
  return text
}

function rowsFrom(variables: Record<string, unknown> | undefined): Row[] {
  return Object.entries(variables ?? {}).map(([key, value], index) => ({
    id: index,
    key,
    ...valueToText(value),
  }))
}

function valuesFrom(rows: readonly Row[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    result[key] = textToValue(row.text, row.structured)
  }
  return result
}

export function ExportEditor({ variables, editing, onSave, scopeHelp, resolved }: ExportEditorProps) {
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(variables))
  const [nextId, setNextId] = useState(1000)

  const signature = useMemo(() => JSON.stringify(variables ?? {}), [variables])
  // Every save reparses the document and hands the block back, which would wipe
  // a half-typed row — the name entered but not yet its value. So the draft is
  // only replaced when the document says something the rows do not already say.
  useEffect(() => {
    setRows((current) =>
      JSON.stringify(valuesFrom(current)) === signature ? current : rowsFrom(variables))
  }, [signature])

  const entries = Object.entries(variables ?? {})

  const commit = (next: Row[]) => onSave(valuesFrom(next))

  if (!editing) {
    return (
      <div className="export-view">
        {entries.length === 0
          ? <p className="inspector-empty-copy">変数は設定されていません。</p>
          : (
            <dl className="property-list">
              {entries.map(([key, value]) => (
                <div key={key}>
                  <dt><code>${'{'}{key}{'}'}</code></dt>
                  <dd>{valueToText(value).text || '（空）'}</dd>
                </div>
              ))}
            </dl>
          )}
        <p className="export-help"><Variable size={12} /> {scopeHelp}</p>
      </div>
    )
  }

  return (
    <div className="export-editor">
      {rows.map((row, index) => (
        <div className="export-row" key={row.id}>
          <input
            className="inspector-field-input export-key"
            value={row.key}
            placeholder="変数名"
            aria-label={`変数名 ${index + 1}`}
            spellCheck={false}
            onChange={(event) => setRows(rows.map((item) => item.id === row.id ? { ...item, key: event.target.value } : item))}
            onBlur={() => commit(rows)}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
          />
          <input
            className="inspector-field-input export-value"
            value={row.text}
            placeholder={row.structured ? 'JSON' : '値'}
            aria-label={`値 ${index + 1}`}
            spellCheck={false}
            onChange={(event) => setRows(rows.map((item) => item.id === row.id ? { ...item, text: event.target.value } : item))}
            onBlur={() => commit(rows)}
            onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
          />
          <button
            className="icon-button danger subtle"
            type="button"
            title="この変数を削除"
            onClick={() => {
              const next = rows.filter((item) => item.id !== row.id)
              setRows(next)
              commit(next)
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <button
        className="secondary-button"
        type="button"
        onClick={() => {
          setRows([...rows, { id: nextId, key: '', text: '', structured: false }])
          setNextId(nextId + 1)
        }}
      >
        <Plus size={14} /> 変数を追加
      </button>
      <p className="export-help"><Variable size={12} /> {scopeHelp}</p>
      {resolved && Object.keys(resolved).length > 0 && (
        <details className="export-resolved">
          <summary>このタスクで `${'{'}...{'}'}` が展開される値（{Object.keys(resolved).length}件）</summary>
          <dl className="property-list">
            {Object.entries(resolved).map(([key, value]) => (
              <div key={key}>
                <dt><code>{key}</code></dt>
                <dd>{valueToText(value).text || '（空）'}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  )
}
