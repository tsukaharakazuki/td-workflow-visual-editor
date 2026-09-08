import { useMemo, useState } from 'react'
import {
  Braces,
  Code2,
  Database,
  ExternalLink,
  FileCode2,
  GitBranch,
  Info,
  Trash2,
} from 'lucide-react'
import { findSchemaTable } from '../core'
import type { SchemaTable, WorkflowSchema, WorkflowTaskAnalysis } from '../types'

interface TaskInspectorProps {
  analysis?: WorkflowTaskAnalysis
  schemas: WorkflowSchema[]
  onDelete: () => void
  onOpenFile: (path: string) => void
}

type InspectorTab = 'overview' | 'sql' | 'schema'

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
  tone,
}: {
  title: string
  name: string
  schemas: WorkflowSchema[]
  tone: 'input' | 'output'
}) {
  const table = schemaFor(name, schemas)
  return (
    <div className={`inspector-table-card ${tone}`}>
      <div className="inspector-table-heading">
        <span><Database size={14} /></span>
        <div>
          <small>{title}</small>
          <strong>{name}</strong>
        </div>
      </div>
      {table ? (
        <div className="inspector-columns">
          {table.columns.map((column) => (
            <div key={column.name}>
              <span>{column.name}</span>
              <small>{column.type ?? 'unknown'}</small>
            </div>
          ))}
        </div>
      ) : <p className="inspector-empty-copy">スキーマメタデータなし</p>}
    </div>
  )
}

export function TaskInspector({ analysis, schemas, onDelete, onOpenFile }: TaskInspectorProps) {
  const [tab, setTab] = useState<InspectorTab>('overview')
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
  return (
    <aside className="inspector-panel">
      <div className="inspector-header">
        <div className="inspector-task-icon"><Braces size={18} /></div>
        <div>
          <p>Task Inspector</p>
          <h2>{task.name.replace(/^\+/, '')}</h2>
        </div>
        <button className="icon-button danger" type="button" title="タスクを削除" onClick={onDelete}>
          <Trash2 size={17} />
        </button>
      </div>

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
                <div><dt>Database</dt><dd>{task.database ?? '未指定'}</dd></div>
                <div><dt>Engine</dt><dd>{task.engine ?? '継承 / 未指定'}</dd></div>
                <div><dt>Depth</dt><dd>{task.depth}</dd></div>
              </dl>
            </section>
            <section className="property-section">
              <h3>構造</h3>
              <div className="summary-chips">
                <span><GitBranch size={13} /> {task.children.length} child tasks</span>
                <span><Database size={13} /> {inputs.length} inputs</span>
                <span><Database size={13} /> {outputs.length} outputs</span>
              </div>
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
                <pre className="sql-code-block">{analysis.sql.sql}</pre>
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
                  <TableSchemaCard key={`input:${input.qualifiedName}`} title="INPUT" name={input.qualifiedName} schemas={schemas} tone="input" />
                ))}
                {outputs.map((output) => (
                  <TableSchemaCard key={`output:${output.qualifiedName}`} title="OUTPUT" name={output.qualifiedName} schemas={schemas} tone="output" />
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
    </aside>
  )
}
