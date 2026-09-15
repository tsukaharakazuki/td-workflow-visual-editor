import { useEffect, useMemo, useState } from 'react'
import {
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
import { findSchemaTable, inferredTableFor, parallelSettingsForTask } from '../core'
import type { DigdagParallelSettings, InferredTable, SchemaTable, WorkflowSchema, WorkflowTaskAnalysis } from '../types'

interface TaskInspectorProps {
  analysis?: WorkflowTaskAnalysis
  schemas: WorkflowSchema[]
  inferredTables: InferredTable[]
  onDelete: () => void
  onOpenFile: (path: string) => void
  onParallelChange: (settings: DigdagParallelSettings) => void
  onRename: (name: string) => void
  onFieldsChange: (fields: Record<string, string | undefined>) => void
  onSqlSave: (sql: string) => void
}

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
  onDelete,
  onOpenFile,
  onParallelChange,
  onRename,
  onFieldsChange,
  onSqlSave,
}: TaskInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('overview')
  const [editing, setEditing] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [databaseDraft, setDatabaseDraft] = useState('')
  const [engineDraft, setEngineDraft] = useState('')
  const [sqlDraft, setSqlDraft] = useState('')
  const [targetDraft, setTargetDraft] = useState('')

  const taskId = analysis?.task.id
  const taskName = analysis?.task.name
  const taskDatabase = analysis?.task.database
  const taskEngine = analysis?.task.engine
  const taskSql = analysis?.sql?.sql
  // `create_table` and `insert_into` are the two ways a td> task names its
  // destination; a task carries at most one of them.
  const operatorConfig = (analysis?.task.operatorConfig ?? analysis?.task.value) as Record<string, unknown> | undefined
  const configString = (key: string) => typeof operatorConfig?.[key] === 'string' ? operatorConfig[key] as string : undefined
  const createTable = configString('create_table')
  const insertInto = configString('insert_into')
  const writeMode: WriteMode = createTable !== undefined ? 'create_table' : insertInto !== undefined ? 'insert_into' : 'none'
  const writeTarget = createTable ?? insertInto ?? ''

  // Drafts follow the selected task, and pick up whatever a save reparsed.
  useEffect(() => {
    setNameDraft(taskName?.replace(/^\+/, '') ?? '')
    setDatabaseDraft(taskDatabase ?? '')
    setEngineDraft(taskEngine ?? '')
    setSqlDraft(taskSql ?? '')
    setTargetDraft(writeTarget)
  }, [taskId, taskName, taskDatabase, taskEngine, taskSql, writeTarget])

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
      {editing && <p className="inspector-edit-banner"><Pencil size={12} /> 編集モード — 名前・Database・Engine・書き込み先は、入力後にフォーカスを外すと保存されます</p>}

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
                <div><dt>Operator</dt><dd><code>{task.operator ?? 'group'}</code></dd></div>
                <div><dt>Workflow</dt><dd>{task.documentPath}</dd></div>
                <div><dt>Database</dt><dd>{editing ? (
                  <input
                    className="inspector-field-input"
                    value={databaseDraft}
                    placeholder="未指定"
                    spellCheck={false}
                    onChange={(event) => setDatabaseDraft(event.target.value)}
                    onBlur={() => { if (databaseDraft.trim() !== (task.database ?? '')) onFieldsChange({ database: databaseDraft }) }}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                  />
                ) : task.database ?? '未指定'}</dd></div>
                <div><dt>Engine</dt><dd>{editing ? (
                  <input
                    className="inspector-field-input"
                    value={engineDraft}
                    placeholder="trino / hive"
                    list="inspector-engine-options"
                    spellCheck={false}
                    onChange={(event) => setEngineDraft(event.target.value)}
                    onBlur={() => { if (engineDraft.trim() !== (task.engine ?? '')) onFieldsChange({ engine: engineDraft }) }}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                  />
                ) : task.engine ?? '継承 / 未指定'}</dd></div>
                <div><dt>Depth</dt><dd>{task.depth}</dd></div>
              </dl>
            </section>
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
