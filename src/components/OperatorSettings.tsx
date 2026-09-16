import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { OperatorField, OperatorFieldType } from '../core'

/** A YAML value as the editor sees it, before it goes back into the document. */
export type ConfigValue = unknown

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** How a value reads in a one-line summary, when the field is not being edited. */
export function displayValue(value: unknown): string {
  if (value === undefined || value === null) return '未設定'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return value || '（空）'
  if (Array.isArray(value)) return value.map((item) => displayValue(item)).join(', ')
  if (isPlainObject(value)) return JSON.stringify(value)
  return String(value)
}

function linesToList(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}

/**
 * One setting. Which control it gets comes from the type the documentation
 * gives the key, so a boolean is a checkbox and a list is one value per line
 * rather than everything being a text box.
 */
function FieldControl({
  field,
  value,
  onCommit,
}: {
  field: OperatorField
  value: unknown
  onCommit: (next: ConfigValue) => void
}) {
  const [draft, setDraft] = useState('')

  // The draft follows whatever the document says after a save or a reselect.
  useEffect(() => {
    if (field.type === 'list') setDraft(Array.isArray(value) ? value.map(String).join('\n') : value === undefined ? '' : String(value))
    else if (field.type === 'json' || field.type === 'map') setDraft(value === undefined ? '' : JSON.stringify(value, null, 2))
    else setDraft(value === undefined || value === null ? '' : String(value))
  }, [field.key, field.type, value])

  const listId = `operator-field-${field.key.replace(/[^\w]/g, '_')}`

  if (field.type === 'boolean') {
    return (
      <label className="operator-field-boolean">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onCommit(event.target.checked ? true : undefined)}
        />
        <span>{value === true ? 'true' : '未設定（既定のまま）'}</span>
      </label>
    )
  }

  if (field.type === 'tasks') {
    return <p className="operator-field-readonly">子タスクはタスクツリーとグラフで編集します。</p>
  }

  if (field.type === 'list') {
    return (
      <textarea
        className="operator-field-textarea"
        rows={Math.min(6, Math.max(2, draft.split('\n').length))}
        value={draft}
        spellCheck={false}
        placeholder="1行に1つ"
        aria-label={field.label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const list = linesToList(draft)
          onCommit(list.length > 0 ? list : undefined)
        }}
      />
    )
  }

  if (field.type === 'json' || field.type === 'map') {
    let invalid = false
    if (draft.trim()) {
      try { JSON.parse(draft) } catch { invalid = true }
    }
    return (
      <>
        <textarea
          className={`operator-field-textarea ${invalid ? 'is-invalid' : ''}`}
          rows={Math.min(10, Math.max(3, draft.split('\n').length))}
          value={draft}
          spellCheck={false}
          placeholder={field.type === 'map' ? '{ "key": "value" }' : 'JSON'}
          aria-label={field.label}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (!draft.trim()) { onCommit(undefined); return }
            try { onCommit(JSON.parse(draft)) } catch { /* left for the user to fix */ }
          }}
        />
        {invalid && <small className="operator-field-error">JSONとして読めません。直すまで保存されません。</small>}
      </>
    )
  }

  if (field.type === 'sql') {
    return (
      <textarea
        className="operator-field-textarea"
        rows={Math.min(14, Math.max(3, draft.split('\n').length))}
        value={draft}
        spellCheck={false}
        aria-label={field.label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(draft.trim() ? draft : undefined)}
      />
    )
  }

  const numeric = field.type === 'number'
  return (
    <>
      <input
        className="inspector-field-input"
        type={numeric ? 'number' : 'text'}
        value={draft}
        spellCheck={false}
        placeholder={field.type === 'duration' ? '例: 30s' : '未設定'}
        aria-label={field.label}
        {...(field.options ? { list: listId } : {})}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
        onBlur={() => {
          const trimmed = draft.trim()
          if (!trimmed) { onCommit(undefined); return }
          if (numeric) {
            const parsed = Number(trimmed)
            onCommit(Number.isFinite(parsed) ? parsed : undefined)
            return
          }
          onCommit(trimmed)
        }}
      />
      {field.options && (
        <datalist id={listId}>{field.options.map((option) => <option key={option} value={option} />)}</datalist>
      )}
    </>
  )
}

export function OperatorFieldRow({
  field,
  value,
  editing,
  onCommit,
  onRemove,
}: {
  field: OperatorField
  value: unknown
  editing: boolean
  onCommit: (next: ConfigValue) => void
  onRemove?: () => void
}) {
  return (
    <div className={`operator-field ${field.required ? 'is-required' : ''}`}>
      <div className="operator-field-head">
        <label>
          <strong>{field.label}</strong>
          <code>{field.key}</code>
        </label>
        {field.required && <span className="operator-field-badge">必須</span>}
        {editing && onRemove && value !== undefined && (
          <button className="icon-button danger subtle" type="button" title={`${field.key} を削除`} onClick={onRemove}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {editing
        ? <FieldControl field={field} value={value} onCommit={onCommit} />
        : <p className="operator-field-value">{displayValue(value)}</p>}
      {field.help && <small className="operator-field-help">{field.help}</small>}
    </div>
  )
}

/** The picker that adds one of the operator's documented but unset settings. */
export function AddFieldPicker({
  fields,
  onAdd,
}: {
  fields: readonly OperatorField[]
  onAdd: (field: OperatorField) => void
}) {
  const [choice, setChoice] = useState('')
  if (fields.length === 0) return null
  return (
    <div className="operator-add-field">
      <select
        value={choice}
        aria-label="設定項目を追加"
        onChange={(event) => setChoice(event.target.value)}
      >
        <option value="">未設定の項目を追加…</option>
        {fields.map((field) => (
          <option key={field.key} value={field.key}>{field.label}（{field.key}）</option>
        ))}
      </select>
      <button
        className="secondary-button"
        type="button"
        disabled={!choice}
        onClick={() => {
          const field = fields.find((item) => item.key === choice)
          if (field) onAdd(field)
          setChoice('')
        }}
      >
        <Plus size={14} /> 追加
      </button>
    </div>
  )
}

/** The empty value a newly added field starts from, by type. */
export function blankValueFor(type: OperatorFieldType): ConfigValue {
  switch (type) {
    case 'boolean': return true
    case 'number': return 0
    case 'list': return ['']
    case 'map': return {}
    case 'json': return {}
    default: return ''
  }
}
