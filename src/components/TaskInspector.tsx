import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Braces,
  Code2,
  Database,
  ExternalLink,
  FileCode2,
  GitBranch,
  Info,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react'
import {
  COMMON_TASK_FIELDS,
  findSchemaTable,
  handledTaskKeys,
  inferredTableFor,
  operatorDefinition,
  operatorFields,
  parallelSettingsForTask,
} from '../core'
import type { DigdagParallelSettings, InferredTable, SchemaTable, WorkflowSchema, WorkflowTaskAnalysis } from '../types'
import { AddFieldPicker, OperatorFieldRow, blankValueFor } from './OperatorSettings'
import { ExportEditor } from './ExportEditor'

interface TaskInspectorProps {
  analysis?: WorkflowTaskAnalysis
  schemas: WorkflowSchema[]
  inferredTables: InferredTable[]
  /** Values `${...}` resolves to for this task, for the _export preview. */
  resolvedVariables?: Record<string, unknown>
  onDelete: () => void
  onOpenFile: (path: string) => void
  onParallelChange: (settings: DigdagParallelSettings) => void
  onRename: (name: string) => void
  onFieldsChange: (fields: Record<string, string | undefined>) => void
  onConfigChange: (values: Record<string, unknown>) => void
  onExportChange: (variables: Record<string, unknown>) => void
  onSqlSave: (sql: string) => void
}

/** `_export` is edited in its own section, not among the operator settings. */
const COMMON_FIELDS_IN_FORM = COMMON_TASK_FIELDS.filter((field) => field.key !== '_export' && field.key !== '_parallel')

type InspectorTab = 'overview' | 'sql' | 'schema'
type WriteMode = 'create_table' | 'insert_into' | 'none'

const WRITE_MODE_LABEL: Record<WriteMode, string> = {
  create_table: 'CREATE TABLE',
  insert_into: 'INSERT INTO',
  none: '書き込まない',
}

/** Operators that write their result to a table. */
function writesATable(operator: string | undefined, hasTarget: boolean): boolean {
  if (hasTarget) return true
  return operator === 'td>' || operator === 'td_run>'
}

function schemaFor(name: string, schemas: WorkflowSchema[]): SchemaTable | undefined {
  const [database, ...rest] = name.includes('.') ? name.split('.') : [undefined, name]
  const table = rest.join('.')
  return findSchemaTable({
    name: table,
    qualifiedName: name,
    ...(database ? { database } : {}),
  }, schemas).table
}

function TableSchemaCard({
  title,
  name,
  schemas,
  inferredTables,
  tone,
}: {
  title: string
  name: string
  schemas: WorkflowSchema[]
  inferredTables: InferredTable[]
  tone: 'input' | 'output'
}) {
  const table = schemaFor(name, schemas)
  // With no schema sidecar, show what the SQL itself reveals, marked as a guess.
  const inferred = table ? undefined : inferredTableFor(name, inferredTables)
  const columns: Array<{ name: string; type: string }> = table
    ? table.columns.map((column) => ({ name: column.name, type: column.type ?? 'unknown' }))
    : inferred?.columns.map((column) => ({
      name: column.name,
      type: column.origin === 'output' ? 'SELECT' : '参照',
    })) ?? []
  return (
    <div className={`inspector-table-card ${tone}`}>
      <div className="inspector-table-heading">
        <span><Database size={14} /></span>
        <div>
          <small>{title}{inferred && columns.length > 0 ? ' · SQLから推定' : ''}</small>
          <strong>{name}</strong>
        </div>
      </div>
      {columns.length > 0 ? (
        <div className="inspector-columns">
          {columns.map((column) => (
            <div key={column.name}>
              <span>{column.name}</span>
              <small>{column.type}</small>
            </div>
          ))}
        </div>
      ) : <p className="inspector-empty-copy">スキーマメタデータなし</p>}
    </div>
  )
}

export function TaskInspector({
  analysis,
  schemas,
  inferredTables,
  resolvedVariables,
  onDelete,
  onOpenFile,
  onParallelChange,
  onRename,
  onFieldsChange,
  onConfigChange,
  onExportChange,
  onSqlSave,
}: TaskInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('overview')
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [sqlDraft, setSqlDraft] = useState('')
  const [targetDraft, setTargetDraft] = useState('')

  const taskId = analysis?.task.id
  const taskName = analysis?.task.name
  const taskSql = analysis?.sql?.sql
  // `create_table` and `insert_into` are the two ways a query task names its
  // destination; a task carries at most one of them.
  const operatorConfig = (analysis?.task.operatorConfig ?? analysis?.task.value) as Record<string, unknown> | undefined
  const configString = (key: string) => typeof operatorConfig?.[key] === 'string' ? operatorConfig[key] as string : undefined
  const createTable = configString('create_table')
  const insertInto = configString('insert_into')
  const writeMode: WriteMode = createTable !== undefined ? 'create_table' : insertInto !== undefined ? 'insert_into' : 'none'
  const writeTarget = createTable ?? insertInto ?? ''

  const operator = analysis?.task.operator
  const definition = operatorDefinition(operator)
  const allFields = useMemo(
    () => [...operatorFields(operator), ...COMMON_FIELDS_IN_FORM],
    [operator],
  )
  // A field belongs in the form once the task sets it, or once the user picks
  // it from the list; everything else stays behind the picker so a task with
  // three settings does not show forty empty boxes.
  const [addedKeys, setAddedKeys] = useState<string[]>([])
  useEffect(() => { setAddedKeys([]) }, [taskId])

  // create_table / insert_into have their own switch below, and the query has
  // its own tab, so neither is repeated among the plain settings.
  const ownSectionKeys = new Set(['create_table', 'insert_into', 'query', 'sql'])
  const taskBody = (analysis?.task.value ?? {}) as Record<string, unknown>
  const isSet = (key: string) =>
    (operatorConfig && operatorConfig[key] !== undefined) || taskBody[key] !== undefined
  const shownFields = allFields.filter((field) =>
    !ownSectionKeys.has(field.key) && (isSet(field.key) || addedKeys.includes(field.key)))
  const availableFields = allFields.filter((field) =>
    !ownSectionKeys.has(field.key) && !isSet(field.key) && !addedKeys.includes(field.key))

  const valueOf = (key: string) => operatorConfig?.[key] ?? taskBody[key]
  /** What sits on the operator key itself — the method name, message, path. */
  const operatorValue = operator ? valueOf(operator) : undefined
  /** True when the operator key carries the query text rather than a path. */
  const sqlRef = analysis?.task.sql
  const inlineQueryIsTheValue = sqlRef?.kind === 'inline'
    && sqlRef.yamlPath?.[sqlRef.yamlPath.length - 1] === operator

  // Anything in the task body the form does not already account for. Showing it
  // is the difference between "the editor matches the task" and "the editor
  // quietly hides half the YAML".
  const handled = useMemo(() => handledTaskKeys(operator), [operator])
  const extraEntries = useMemo(() => {
    const merged: Record<string, unknown> = { ...taskBody, ...(operatorConfig ?? {}) }
    return Object.entries(merged).filter(([key]) =>
      !handled.has(key) && !ownSectionKeys.has(key) && !key.startsWith('+'))
  }, [taskBody, operatorConfig, handled])

  const taskExport = (taskBody._export ?? undefined) as Record<string, unknown> | undefined

  // Drafts follow the selected task, and pick up whatever a save reparsed.
  useEffect(() => {
    setNameDraft(taskName?.replace(/^\+/, '') ?? '')
    setSqlDraft(taskSql ?? '')
    setTargetDraft(writeTarget)
  }, [taskId, taskName, taskSql, writeTarget])

  const inputs = analysis?.sql?.sources ?? []
  const outputs = analysis?.sql?.targets ?? []
  const columnMappings = useMemo(() => {
    if (!analysis?.sql) return []
    return analysis.sql.outputColumns.map((column) => ({
      source: column.expression,
      target: column.name,
      confidence: column.wildcard ? 'schema展開' : column.alias ? 'alias' : '推定',
    }))
  }, [analysis])

  if (!analysis) {
    return (
      <aside className="inspector-panel inspector-placeholder">
        <span><Info size={24} /></span>
        <h3>Task Inspector</h3>
        <p>パイプライン上のタスクを選択すると、演算子、SQL、入出力テーブルとスキーマを確認できます。</p>
      </aside>
    )
  }

  const task = analysis.task
  const parallel = parallelSettingsForTask(task)
  const canConfigureParallel = !task.operator || task.children.length > 0 || parallel.enabled
  return (
    <aside className="inspector-panel">
      <div className="inspector-header">
        <div className="inspector-task-icon"><Braces size={18} /></div>
        <div>
          <p>Task Inspector</p>
          {editing ? (
            <input
              className="inspector-name-input"
              value={nameDraft}
              aria-label="タスク名"
              spellCheck={false}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => { if (nameDraft.trim() && `+${nameDraft.trim()}` !== task.name) onRename(nameDraft) }}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
            />
          ) : <h2>{task.name.replace(/^\+/, '')}</h2>}
        </div>
        <div className="inspector-header-actions">
          <button
            className={`icon-button ${editing ? 'is-editing' : ''}`}
            type="button"
            role="switch"
            aria-checked={editing}
            title={editing ? '編集モードを終了' : '編集モードにする'}
            onClick={() => setEditing((current) => !current)}
          >
            <Pencil size={16} />
          </button>
          <button className="icon-button danger" type="button" title="タスクを削除" onClick={onDelete}>
            <Trash2 size={17} />
          </button>
        </div>
      </div>
      {editing && <p className="inspector-edit-banner"><Pencil size={12} /> 編集モード — 各項目は入力後にフォーカスを外すと保存されます</p>}

      <div className="inspector-tabs" role="tablist" aria-label="Task details">
        <button type="button" className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>概要</button>
        <button type="button" className={tab === 'sql' ? 'active' : ''} onClick={() => setTab('sql')}>SQL</button>
        <button type="button" className={tab === 'schema' ? 'active' : ''} onClick={() => setTab('schema')}>入出力</button>
      </div>

      <div className="inspector-body">
        {tab === 'overview' && (
          <>
            <section className="property-section">
              <h3>タスク情報</h3>
              <dl className="property-list">
                <div><dt>Operator</dt><dd>
                  <code>{task.operator ?? 'group'}</code>
                  {definition?.doc && (
                    <a className="operator-doc-link" href={definition.doc} target="_blank" rel="noreferrer" title="公式ドキュメントを開く">
                      <BookOpen size={13} />
                    </a>
                  )}
                </dd></div>
                <div><dt>Workflow</dt><dd>{task.documentPath}</dd></div>
                <div><dt>Depth</dt><dd>{task.depth}</dd></div>
              </dl>
              {definition
                ? <p className="operator-summary">{definition.summary}</p>
                : task.operator && <p className="operator-summary unknown">このオペレーターの定義は未登録です。設定は下の「その他の設定」で編集できます。</p>}
            </section>

            {(definition?.valueLabel || shownFields.length > 0 || (editing && availableFields.length > 0)) && (
              <section className="property-section operator-settings-section">
                <div className="section-heading-row">
                  <h3>オペレーター設定</h3>
                  <span className="operator-key-badge"><code>{task.operator}</code></span>
                </div>
                {definition?.valueLabel && (
                  // The operator's own value is the message, the method name,
                  // the query path. It is editable unless it holds the query
                  // itself, which belongs to the SQL tab.
                  <OperatorFieldRow
                    field={{
                      key: task.operator ?? '',
                      type: inlineQueryIsTheValue ? 'tasks' : definition.valueType === 'map' || definition.valueType === 'tasks' ? 'json' : definition.valueType === 'sql' ? 'string' : definition.valueType ?? 'string',
                      label: '値',
                      help: inlineQueryIsTheValue ? 'このタスクはクエリを直接持っています。SQLタブで編集してください。' : definition.valueLabel,
                    }}
                    value={operatorValue}
                    editing={editing}
                    onCommit={(next) => { if (task.operator) onConfigChange({ [task.operator]: next }) }}
                  />
                )}
                {shownFields.map((field) => (
                  <OperatorFieldRow
                    key={field.key}
                    field={field}
                    value={valueOf(field.key)}
                    editing={editing}
                    onCommit={(next) => onConfigChange({ [field.key]: next })}
                    onRemove={() => {
                      setAddedKeys(addedKeys.filter((key) => key !== field.key))
                      onConfigChange({ [field.key]: undefined })
                    }}
                  />
                ))}
                {shownFields.length === 0 && !definition?.valueLabel && (
                  <p className="inspector-empty-copy">設定されている項目はありません。</p>
                )}
                {editing && (
                  <AddFieldPicker
                    fields={availableFields}
                    onAdd={(field) => {
                      setAddedKeys([...addedKeys, field.key])
                      if (field.type !== 'tasks') onConfigChange({ [field.key]: blankValueFor(field.type) })
                    }}
                  />
                )}
              </section>
            )}
            {writesATable(task.operator, writeMode !== 'none') && (
              <section className="property-section">
                <div className="section-heading-row">
                  <h3>書き込み先</h3>
                  {!editing && <span className="write-mode-badge">{WRITE_MODE_LABEL[writeMode]}</span>}
                </div>
                {editing ? (
                  <>
                    <div className="write-mode-switch" role="group" aria-label="書き込みモード">
                      {(['create_table', 'insert_into', 'none'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          className={writeMode === mode ? 'active' : ''}
                          aria-pressed={writeMode === mode}
                          onClick={() => {
                            if (mode === writeMode) return
                            const name = targetDraft.trim() || `${task.name.replace(/^\+/, '')}_output`
                            onFieldsChange(mode === 'none'
                              ? { create_table: '', insert_into: '' }
                              : mode === 'create_table'
                                ? { create_table: name, insert_into: '' }
                                : { insert_into: name, create_table: '' })
                          }}
                        >
                          {WRITE_MODE_LABEL[mode]}
                        </button>
                      ))}
                    </div>
                    {writeMode !== 'none' && (
                      <input
                        className="inspector-field-input write-target-input"
                        value={targetDraft}
                        placeholder="テーブル名"
                        aria-label="書き込み先テーブル名"
                        spellCheck={false}
                        onChange={(event) => setTargetDraft(event.target.value)}
                        onBlur={() => { if (targetDraft.trim() && targetDraft.trim() !== writeTarget) onFieldsChange({ [writeMode]: targetDraft }) }}
                        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                      />
                    )}
                    <p className="write-mode-help">CREATE TABLE は毎回作り直し、INSERT INTO は追記します。</p>
                  </>
                ) : (
                  <dl className="property-list">
                    <div><dt>テーブル</dt><dd>{writeTarget || '未指定'}</dd></div>
                  </dl>
                )}
              </section>
            )}
            {(extraEntries.length > 0 || !definition) && (
              <section className="property-section">
                <div className="section-heading-row">
                  <h3>その他の設定</h3>
                  <span className="operator-key-badge">{extraEntries.length}件</span>
                </div>
                {extraEntries.length === 0
                  ? <p className="inspector-empty-copy">このタスクに他のキーはありません。</p>
                  : extraEntries.map(([key, value]) => (
                    <OperatorFieldRow
                      key={key}
                      field={{ key, type: typeof value === 'object' && value !== null ? 'json' : typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'number' : 'string', label: key }}
                      value={value}
                      editing={editing}
                      onCommit={(next) => onConfigChange({ [key]: next })}
                      onRemove={() => onConfigChange({ [key]: undefined })}
                    />
                  ))}
                <p className="operator-field-help">定義に無いキーはそのまま表示・編集します。値の型はYAMLから推定しています。</p>
              </section>
            )}

            <section className="property-section export-section">
              <div className="section-heading-row">
                <h3>_export（このタスク）</h3>
                {taskExport && <span className="operator-key-badge">{Object.keys(taskExport).length}件</span>}
              </div>
              <ExportEditor
                variables={taskExport}
                editing={editing}
                onSave={onExportChange}
                scopeHelp="このタスクと、その配下の子タスクに渡る変数です。"
                resolved={resolvedVariables}
              />
            </section>

            <section className="property-section">
              <h3>構造</h3>
              <div className="summary-chips">
                <span><GitBranch size={13} /> {task.children.length} child tasks</span>
                <span><Database size={13} /> {inputs.length} inputs</span>
                <span><Database size={13} /> {outputs.length} outputs</span>
              </div>
            </section>
            <section className="property-section parallel-settings-section">
              <div className="section-heading-row">
                <h3>子タスクの実行モード</h3>
                <span className={`parallel-mode-badge ${parallel.enabled ? 'parallel' : ''}`}>{parallel.enabled ? 'Parallel' : 'Sequential'}</span>
              </div>
              <label className={`parallel-toggle ${!canConfigureParallel ? 'disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={parallel.enabled}
                  disabled={!canConfigureParallel}
                  onChange={(event) => onParallelChange({ enabled: event.target.checked })}
                />
                <span className="parallel-toggle-track"><i /></span>
                <span><strong>子タスクを並列実行</strong><small>選択中のグループ直下にあるタスクへ `_parallel` を適用します。</small></span>
              </label>
              {!canConfigureParallel && <p className="parallel-help">子タスクを持つグループで設定できます。Add Taskの「Parallel Group」から新規作成もできます。</p>}
              {parallel.enabled && (
                <div className="parallel-options">
                  <label>
                    <span>同時実行数</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      placeholder="制限なし"
                      value={parallel.limit ?? ''}
                      onChange={(event) => {
                        const limit = event.target.value === '' ? undefined : Number(event.target.value)
                        if (limit === undefined || (Number.isInteger(limit) && limit > 0)) onParallelChange({ ...parallel, limit })
                      }}
                    />
                  </label>
                  <label className="parallel-eager-option">
                    <input type="checkbox" checked={parallel.eager ?? false} onChange={(event) => onParallelChange({ ...parallel, eager: event.target.checked })} />
                    <span><strong>eager</strong><small>空きができ次第、次のタスクを開始</small></span>
                  </label>
                </div>
              )}
            </section>
            {analysis.sourceFilePath && (
              <section className="property-section">
                <h3>参照ファイル</h3>
                <button className="file-link-button" type="button" onClick={() => onOpenFile(analysis.sourceFilePath as string)}>
                  <FileCode2 size={16} />
                  <span>{analysis.sourceFilePath}</span>
                  <ExternalLink size={14} />
                </button>
              </section>
            )}
            <section className="property-section">
              <h3>Raw task</h3>
              <pre className="mini-code-block">{JSON.stringify(task.value, null, 2)}</pre>
            </section>
          </>
        )}

        {tab === 'sql' && (
          <section className="property-section sql-section">
            <div className="section-heading-row">
              <h3><Code2 size={15} /> SQL</h3>
              {analysis.sourceFilePath && (
                <button type="button" onClick={() => onOpenFile(analysis.sourceFilePath as string)}>ファイルを編集</button>
              )}
            </div>
            {analysis.sql ? (
              <>
                {editing ? (
                  <>
                    <textarea
                      className="sql-editor"
                      value={sqlDraft}
                      spellCheck={false}
                      aria-label="SQL"
                      onChange={(event) => setSqlDraft(event.target.value)}
                    />
                    <div className="sql-editor-actions">
                      <small>{analysis.sourceFilePath ? `保存先: ${analysis.sourceFilePath}` : 'ワークフロー内のインラインクエリ'}</small>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={sqlDraft === analysis.sql.sql}
                        onClick={() => onSqlSave(sqlDraft)}
                      >
                        <Save size={15} /> SQLを保存
                      </button>
                    </div>
                  </>
                ) : <pre className="sql-code-block">{analysis.sql.sql}</pre>}
                <div className="sql-summary">
                  <span>{analysis.sql.cteNames.length} CTE</span>
                  <span>{analysis.sql.outputColumns.length} projected columns</span>
                </div>
              </>
            ) : (
              <div className="inline-empty"><Code2 size={22} /><p>このタスクに解析可能なSQLはありません。</p></div>
            )}
          </section>
        )}

        {tab === 'schema' && (
          <>
            <section className="property-section">
              <h3>テーブル入出力</h3>
              <div className="inspector-table-grid">
                {inputs.map((input) => (
                  <TableSchemaCard key={`input:${input.qualifiedName}`} title="INPUT" name={input.qualifiedName} schemas={schemas} inferredTables={inferredTables} tone="input" />
                ))}
                {outputs.map((output) => (
                  <TableSchemaCard key={`output:${output.qualifiedName}`} title="OUTPUT" name={output.qualifiedName} schemas={schemas} inferredTables={inferredTables} tone="output" />
                ))}
                {inputs.length === 0 && outputs.length === 0 && (
                  <div className="inline-empty"><Database size={22} /><p>テーブル入出力は検出されませんでした。</p></div>
                )}
              </div>
            </section>
            {columnMappings.length > 0 && (
              <section className="property-section">
                <h3>出力カラム</h3>
                <div className="column-mapping-list">
                  {columnMappings.map((mapping, index) => (
                    <div key={`${mapping.target}:${index}`}>
                      <code>{mapping.source}</code>
                      <span>→</span>
                      <strong>{mapping.target}</strong>
                      <small>{mapping.confidence}</small>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <datalist id="inspector-engine-options">
        <option value="trino" />
        <option value="hive" />
      </datalist>
    </aside>
  )
}
