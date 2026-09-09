import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactNode,
} from 'react'
import {
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  BookOpen,
  Box,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  Cloud,
  CircleX,
  Clock3,
  Database,
  Download,
  FileArchive,
  FileCode2,
  FileDown,
  FileJson2,
  FileText,
  FolderOpen,
  Globe2,
  GitBranch,
  GitFork,
  GripVertical,
  ImageDown,
  Info,
  Layers3,
  ListTree,
  LoaderCircle,
  LockKeyhole,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Repeat2,
  Search,
  Settings2,
  Terminal,
  ShieldCheck,
  Sparkles,
  TableProperties,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { toPng } from 'html-to-image'
import { jsPDF } from 'jspdf'
import {
  addSiblingTask,
  analyzeWorkflow,
  deleteDigdagTask,
  exportWorkflowZip,
  ingestWorkflowZip,
  reorderSiblingTasks,
  updateWorkflowFileText,
} from './core'
import type {
  Diagnostic,
  DigdagDocument,
  DigdagTaskNode,
  WorkflowAnalysis,
  WorkflowArchive,
  WorkflowFile,
} from './types'
import { TaskInspector } from './components/TaskInspector'
import { WorkflowGraph } from './components/WorkflowGraph'
import './App.css'

type View = 'pipeline' | 'combined' | 'lineage' | 'files' | 'diagnostics' | 'guide'

interface ToastState {
  type: 'success' | 'error' | 'info'
  message: string
}

const OPERATOR_PALETTE = [
  // Frequently used operators stay visible in the compact palette.
  { operator: 'td>', label: 'TD Query', description: 'SQLを実行', category: 'Treasure Data', icon: Database, tone: 'query' },
  { operator: 'if>', label: 'Condition', description: '条件分岐', category: '制御', icon: GitBranch, tone: 'control' },
  { operator: 'for_each>', label: 'For Each', description: '値ごとに繰り返し', category: '制御', icon: Repeat2, tone: 'control' },
  { operator: 'call>', label: 'Call', description: '別Workflowを呼び出す', category: '制御', icon: Layers3, tone: 'reference' },
  { operator: 'echo>', label: 'Echo', description: 'メッセージを表示', category: '制御', icon: Braces, tone: 'neutral' },
  { operator: 'py>', label: 'Python', description: 'Pythonを実行', category: 'スクリプト', icon: Code2, tone: 'script' },
  { operator: 'http_call>', label: 'HTTP Call', description: 'HTTP経由でWorkflowを呼び出す', category: '制御', icon: Globe2, tone: 'reference' },
  { operator: 'require>', label: 'Require', description: '別Workflowの完了を待つ', category: '制御', icon: Layers3, tone: 'reference' },
  { operator: 'loop>', label: 'Loop', description: 'タスクを繰り返す', category: '制御', icon: Repeat2, tone: 'control' },
  { operator: 'for_range>', label: 'For Range', description: '指定範囲で繰り返す', category: '制御', icon: Repeat2, tone: 'control' },
  { operator: 'fail>', label: 'Fail', description: 'Workflowを失敗させる', category: '制御', icon: CircleX, tone: 'control' },
  { operator: 'wait>', label: 'Wait', description: '指定時間待機', category: '制御', icon: Clock3, tone: 'control' },
  { operator: 'td_run>', label: 'TD Run', description: '保存済みクエリを実行', category: 'Treasure Data', icon: Database, tone: 'query' },
  { operator: 'td_ddl>', label: 'TD DDL', description: 'Treasure Dataを操作', category: 'Treasure Data', icon: Database, tone: 'query' },
  { operator: 'td_load>', label: 'TD Load', description: 'Treasure Dataへロード', category: 'Treasure Data', icon: Database, tone: 'query' },
  { operator: 'td_for_each>', label: 'TD For Each', description: 'クエリ結果で反復', category: 'Treasure Data', icon: Database, tone: 'query' },
  { operator: 'td_wait>', label: 'TD Wait', description: 'データ到着を待機', category: 'Treasure Data', icon: Clock3, tone: 'query' },
  { operator: 'td_wait_table>', label: 'TD Wait Table', description: 'テーブル到着を待機', category: 'Treasure Data', icon: Clock3, tone: 'query' },
  { operator: 'td_table_export>', label: 'TD Table Export', description: 'テーブルをS3へ出力', category: 'Treasure Data', icon: Database, tone: 'query' },
  { operator: 'td_result_export>', label: 'TD Result Export', description: 'クエリ結果を出力', category: 'Treasure Data', icon: Database, tone: 'query' },
  { operator: 'mail>', label: 'Mail', description: 'メールを送信', category: 'ネットワーク', icon: Mail, tone: 'reference' },
  { operator: 'http>', label: 'HTTP', description: 'HTTPリクエストを実行', category: 'ネットワーク', icon: Globe2, tone: 'reference' },
  { operator: 'databricks>', label: 'Databricks', description: 'DatabricksでSQLを実行', category: 'データベース', icon: Database, tone: 'query' },
  { operator: 'pg>', label: 'PostgreSQL', description: 'PostgreSQLを操作', category: 'データベース', icon: Database, tone: 'query' },
  { operator: 'snowflake>', label: 'Snowflake', description: 'SnowflakeでSQLを実行', category: 'データベース', icon: Database, tone: 'query' },
  { operator: 's3_wait>', label: 'S3 Wait', description: 'S3ファイルを待機', category: 'AWS', icon: Cloud, tone: 'reference' },
  { operator: 's3_copy>', label: 'S3 Copy', description: 'S3内でコピー', category: 'AWS', icon: Cloud, tone: 'reference' },
  { operator: 's3_delete>', label: 'S3 Delete', description: 'S3ファイルを削除', category: 'AWS', icon: Cloud, tone: 'reference' },
  { operator: 's3_move>', label: 'S3 Move', description: 'S3内で移動', category: 'AWS', icon: Cloud, tone: 'reference' },
  { operator: 'redshift>', label: 'Redshift', description: 'Redshiftを操作', category: 'AWS', icon: Database, tone: 'query' },
  { operator: 'redshift_load>', label: 'Redshift Load', description: 'Redshiftへロード', category: 'AWS', icon: Database, tone: 'query' },
  { operator: 'redshift_unload>', label: 'Redshift Unload', description: 'Redshiftからアンロード', category: 'AWS', icon: Database, tone: 'query' },
  { operator: 'gcs_wait>', label: 'GCS Wait', description: 'GCSファイルを待機', category: 'Google Cloud', icon: Cloud, tone: 'reference' },
  { operator: 'bq>', label: 'BigQuery', description: 'BigQueryを実行', category: 'Google Cloud', icon: Database, tone: 'query' },
  { operator: 'bq_ddl>', label: 'BigQuery DDL', description: 'BigQueryを管理', category: 'Google Cloud', icon: Database, tone: 'query' },
  { operator: 'bq_extract>', label: 'BigQuery Extract', description: 'BigQueryから出力', category: 'Google Cloud', icon: Database, tone: 'query' },
  { operator: 'bq_load>', label: 'BigQuery Load', description: 'BigQueryへインポート', category: 'Google Cloud', icon: Database, tone: 'query' },
  { operator: 'embulk>', label: 'Embulk', description: 'Embulkでデータ転送', category: 'Digdag / その他', icon: Settings2, tone: 'script' },
  { operator: 'emr>', label: 'EMR', description: 'Amazon EMRジョブを実行', category: 'Digdag / その他', icon: Cloud, tone: 'script' },
  { operator: 'sh>', label: 'Shell', description: 'シェルスクリプトを実行', category: 'Digdag / その他', icon: Terminal, tone: 'script' },
  { operator: 'rb>', label: 'Ruby', description: 'Rubyスクリプトを実行', category: 'Digdag / その他', icon: Code2, tone: 'script' },
  { operator: 'param_get>', label: 'Param Get', description: '永続パラメータを取得', category: 'Digdag / その他', icon: Settings2, tone: 'neutral' },
  { operator: 'param_set>', label: 'Param Set', description: '永続パラメータを保存', category: 'Digdag / その他', icon: Settings2, tone: 'neutral' },
] as const

const INITIAL_OPERATOR_COUNT = 6
const OPERATOR_CATEGORIES = [...new Set(OPERATOR_PALETTE.map((item) => item.category))] as const

type OperatorPaletteItem = (typeof OPERATOR_PALETTE)[number]

function operatorCards(items: readonly OperatorPaletteItem[], onAddOperator: (operator: string) => void, onClose?: () => void): ReactNode {
  return items.map((item) => {
    const Icon = item.icon
    return (
      <div
        key={item.operator}
        className={`operator-card tone-${item.tone}`}
        title={item.operator}
        draggable
        onClick={() => {
          onAddOperator(item.operator)
          onClose?.()
        }}
        onDragStart={(event) => {
          event.dataTransfer.setData('application/x-workflow-operator', item.operator)
          event.dataTransfer.effectAllowed = 'copy'
        }}
      >
        <span><Icon size={15} /></span>
        <p><strong>{item.label}</strong><small>{item.operator}</small></p>
        <GripVertical size={14} />
      </div>
    )
  })
}

const STUDIO_PROMPT = `このGitHubリポジトリの docs/TREASURE_AI_STUDIO.md を読み、Treasure Workflow Visual EditorにアップロードするZIPを作成してください。
1. 対象のWorkflow Project名を確認してください。
2. tdx wf pull でWorkflowを読み取り専用取得してください。
3. td> SQLのFROM/JOINに現れるソーステーブルを抽出し、tdx describe <database.table> --json でスキーマだけを取得してください。
4. docs/SCHEMA_FORMAT.md に従って schemas/workflow-inspector.schema.json を作成してください。
5. Workflow全ファイルとschema sidecarをZIP化して返してください。
APIキー、.env、secret、ログ、クエリ結果、行データは絶対にZIPへ含めないでください。wf run / push は実行しないでください。`

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function safeProjectName(value: string): string {
  return value
    .replace(/\.zip$/i, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workflow-project'
}

function fileIcon(file: WorkflowFile): ReactNode {
  if (file.kind === 'dig') return <GitFork size={15} />
  if (file.kind === 'sql') return <FileCode2 size={15} />
  if (file.kind === 'schema') return <TableProperties size={15} />
  if (file.path.endsWith('.json')) return <FileJson2 size={15} />
  return <FileText size={15} />
}

function diagnosticIcon(diagnostic: Diagnostic): ReactNode {
  if (diagnostic.severity === 'error') return <X size={15} />
  if (diagnostic.severity === 'warning') return <AlertTriangle size={15} />
  return <Info size={15} />
}

function cloneArchive(archive: WorkflowArchive): WorkflowArchive {
  return {
    ...archive,
    files: archive.files.map((file) => ({ ...file, bytes: new Uint8Array(file.bytes) })),
    diagnostics: [...archive.diagnostics],
  }
}

function replaceArchiveFile(archive: WorkflowArchive, path: string, text: string): WorkflowArchive {
  let previousSize = 0
  let nextSize = 0
  const files = archive.files.map((file) => {
    if (file.path !== path) return file
    previousSize = file.bytes.byteLength
    const updated = updateWorkflowFileText(file, text)
    nextSize = updated.bytes.byteLength
    return updated
  })
  return { ...archive, files, expandedBytes: archive.expandedBytes - previousSize + nextSize }
}

function appendArchiveFile(archive: WorkflowArchive, file: WorkflowFile): WorkflowArchive {
  return {
    ...archive,
    files: [...archive.files, file],
    expandedBytes: archive.expandedBytes + file.bytes.byteLength,
  }
}

function downloadBytes(bytes: Uint8Array, filename: string, type: string) {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const url = URL.createObjectURL(new Blob([buffer], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

function createExportEdgeOverlay(container: HTMLElement): () => void {
  const paths = [...container.querySelectorAll<SVGPathElement>('.react-flow__edge-path')]
  if (paths.length === 0) return () => undefined

  const containerRect = container.getBoundingClientRect()
  const overlay = document.createElementNS(SVG_NAMESPACE, 'svg')
  overlay.classList.add('graph-export-edge-overlay')
  overlay.setAttribute('width', String(containerRect.width))
  overlay.setAttribute('height', String(containerRect.height))
  overlay.setAttribute('viewBox', `0 0 ${containerRect.width} ${containerRect.height}`)
  overlay.setAttribute('aria-hidden', 'true')
  overlay.style.position = 'absolute'
  overlay.style.inset = '0'
  overlay.style.width = '100%'
  overlay.style.height = '100%'
  overlay.style.overflow = 'visible'
  overlay.style.pointerEvents = 'none'
  overlay.style.zIndex = '1'

  const defs = document.createElementNS(SVG_NAMESPACE, 'defs')
  overlay.appendChild(defs)
  paths.forEach((path, index) => {
    const matrix = path.getScreenCTM()
    if (!matrix) return
    let length: number
    try {
      length = path.getTotalLength()
    } catch {
      return
    }
    const steps = Math.max(2, Math.ceil(length / 12))
    const points: string[] = []
    for (let step = 0; step <= steps; step += 1) {
      const local = path.getPointAtLength((length * step) / steps)
      const point = new DOMPoint(local.x, local.y).matrixTransform(matrix)
      const x = point.x - containerRect.left
      const y = point.y - containerRect.top
      points.push(`${step === 0 ? 'M' : 'L'} ${x} ${y}`)
    }

    const style = getComputedStyle(path)
    const stroke = style.stroke === 'none' ? '#aaa7bd' : style.stroke
    const markerId = `graph-export-arrow-${index}`
    const marker = document.createElementNS(SVG_NAMESPACE, 'marker')
    marker.setAttribute('id', markerId)
    marker.setAttribute('markerWidth', '9')
    marker.setAttribute('markerHeight', '9')
    marker.setAttribute('viewBox', '-5 -5 10 10')
    marker.setAttribute('refX', '0')
    marker.setAttribute('refY', '0')
    marker.setAttribute('orient', 'auto')
    marker.setAttribute('markerUnits', 'userSpaceOnUse')
    const arrow = document.createElementNS(SVG_NAMESPACE, 'path')
    arrow.setAttribute('d', 'M -4 -3 L 0 0 L -4 3 Z')
    arrow.setAttribute('fill', stroke)
    marker.appendChild(arrow)
    defs.appendChild(marker)

    const edge = document.createElementNS(SVG_NAMESPACE, 'path')
    edge.setAttribute('d', points.join(' '))
    edge.setAttribute('fill', 'none')
    edge.setAttribute('stroke', stroke)
    edge.setAttribute('stroke-width', style.strokeWidth || '1.5')
    edge.setAttribute('stroke-linecap', 'round')
    edge.setAttribute('stroke-linejoin', 'round')
    if (style.strokeDasharray !== 'none') edge.setAttribute('stroke-dasharray', style.strokeDasharray)
    edge.setAttribute('marker-end', `url(#${markerId})`)
    overlay.appendChild(edge)
  })

  container.appendChild(overlay)
  return () => overlay.remove()
}

function ImportScreen({ onFile, onSample, loading }: {
  onFile: (file: File) => void
  onSample: () => void
  loading: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) onFile(file)
  }

  return (
    <main className="import-screen">
      <div className="import-ambient ambient-one" />
      <div className="import-ambient ambient-two" />
      <header className="import-header">
        <img src={`${import.meta.env.BASE_URL}brand/treasure-ai-master-logo.svg`} alt="Treasure AI" />
        <span />
        <strong>Workflow Visual Editor</strong>
        <div className="privacy-pill"><LockKeyhole size={14} /> Local only</div>
      </header>
      <section className="import-layout">
        <div className="import-intro">
          <div className="eyebrow"><Sparkles size={15} /> Visualize. Understand. Edit.</div>
          <h1>Treasure Workflowを、<br /><span>ひと目でわかる構造へ。</span></h1>
          <p>Workflow Projectのタスク、SQL、テーブルスキーマを端末内だけで解析。パイプラインとデータリネージュを可視化し、GUIで編集できます。</p>
          <div className="feature-list">
            <div><span><ListTree size={18} /></span><p><strong>Task Pipeline</strong><small>.digの階層・並列・条件分岐を図式化</small></p></div>
            <div><span><TableProperties size={18} /></span><p><strong>Schema-aware Lineage</strong><small>SQLとスキーマから入出力を追跡</small></p></div>
            <div><span><ShieldCheck size={18} /></span><p><strong>Browser-only</strong><small>TD認証情報もプロジェクトも送信しません</small></p></div>
          </div>
        </div>
        <div className="import-card-wrap">
          <div
            className={`drop-card ${dragging ? 'is-dragging' : ''}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <div className="drop-icon"><FileArchive size={28} /></div>
            <h2>Workflow ZIPを読み込む</h2>
            <p>Toolbelt / tdxまたはTreasure AI Studioで取得した<br />プロジェクトZIPを選択してください。</p>
            <button className="primary-button large" type="button" onClick={() => inputRef.current?.click()} disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={18} /> : <FolderOpen size={18} />}
              ZIPファイルを選択
            </button>
            <button className="text-button" type="button" onClick={onSample} disabled={loading}>
              サンプルプロジェクトを見る <ChevronRight size={15} />
            </button>
            <input
              ref={inputRef}
              className="visually-hidden"
              type="file"
              accept=".zip,application/zip"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onFile(file)
              }}
            />
            <div className="drop-limit"><Archive size={13} /> 最大100MB / すべてブラウザ内で処理</div>
          </div>
          <div className="privacy-card">
            <LockKeyhole size={17} />
            <div><strong>データは外部に送信されません</strong><p>アップロード、API通信、サーバー保存は行いません。</p></div>
          </div>
        </div>
      </section>
      <footer className="import-footer">Treasure AI Brand Guidelines 2026に準拠したローカルファーストツール</footer>
    </main>
  )
}

function SidebarNav({
  view,
  onView,
  diagnostics,
  collapsed,
}: {
  view: View
  onView: (view: View) => void
  diagnostics: number
  collapsed: boolean
}) {
  const items: Array<{ id: View; label: string; icon: typeof GitBranch; badge?: number }> = [
    { id: 'pipeline', label: 'Task Flow', icon: ListTree },
    { id: 'combined', label: 'Task + Data Flow', icon: GitFork },
    { id: 'lineage', label: 'Data Lineage', icon: TableProperties },
    { id: 'files', label: 'Project Files', icon: FileCode2 },
    { id: 'diagnostics', label: 'Diagnostics', icon: AlertTriangle, badge: diagnostics },
    { id: 'guide', label: 'Import Guide', icon: CircleHelp },
  ]
  return (
    <nav className="sidebar-nav" aria-label="Workspace">
      <p className="sidebar-section-label">Workspace</p>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <button key={item.id} type="button" className={view === item.id ? 'active' : ''} onClick={() => onView(item.id)} title={collapsed ? item.label : undefined}>
            <Icon size={18} />
            {!collapsed && <span>{item.label}</span>}
            {!collapsed && item.badge !== undefined && item.badge > 0 && <small>{item.badge}</small>}
          </button>
        )
      })}
    </nav>
  )
}

function OperatorPalette({ onAddOperator }: { onAddOperator: (operator: string) => void }) {
  const [showMore, setShowMore] = useState(false)
  const initialOperators = OPERATOR_PALETTE.slice(0, INITIAL_OPERATOR_COUNT)

  return (
    <section className="operator-palette">
      <div className="sidebar-section-label-row">
        <p className="sidebar-section-label">Add task</p>
        <span>Drag or click</span>
      </div>
      <div className="operator-grid">
        {operatorCards(initialOperators, onAddOperator)}
      </div>
      <button
        className="operator-more-toggle"
        type="button"
        aria-expanded={showMore}
        aria-haspopup="dialog"
        onClick={() => setShowMore((current) => !current)}
      >
        {showMore ? 'Close operators' : `Show more (${OPERATOR_PALETTE.length - INITIAL_OPERATOR_COUNT})`}
        <ChevronDown size={13} className={showMore ? 'operator-more-chevron is-open' : 'operator-more-chevron'} />
      </button>
      {showMore && (
        <div className="operator-more-panel" role="dialog" aria-label="All Workflow operators">
          <div className="operator-more-header">
            <div><strong>All operators</strong><small>{OPERATOR_PALETTE.length} operators available</small></div>
            <button className="icon-button" type="button" aria-label="Close operator picker" onClick={() => setShowMore(false)}><X size={15} /></button>
          </div>
          <div className="operator-more-scroll">
            {OPERATOR_CATEGORIES.map((category) => {
              const items = OPERATOR_PALETTE.filter((item) => item.category === category)
              return (
                <section className="operator-category" key={category}>
                  <div className="operator-category-heading"><strong>{category}</strong><small>{items.length}</small></div>
                  <div className="operator-more-grid">{operatorCards(items, onAddOperator, () => setShowMore(false))}</div>
                </section>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

function TaskTree({
  document,
  selectedTaskId,
  onSelect,
  onReorder,
  onDeleteDrop,
}: {
  document?: DigdagDocument
  selectedTaskId?: string
  onSelect: (taskId: string) => void
  onReorder: (draggedId: string, targetId: string) => void
  onDeleteDrop: (taskId: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(
    document?.tasks.filter((task) => task.children.length > 0).map((task) => task.id) ?? [],
  ))

  if (!document) return null
  const byParent = new Map<string, DigdagTaskNode[]>()
  document.tasks.forEach((task) => {
    const key = task.parentId ?? 'ROOT'
    const group = byParent.get(key) ?? []
    group.push(task)
    byParent.set(key, group)
  })
  byParent.forEach((group) => group.sort((a, b) => a.order - b.order))

  const renderGroup = (parentId: string, depth: number): ReactNode => (byParent.get(parentId) ?? []).map((task) => {
    const open = expanded.has(task.id)
    return (
      <div key={task.id}>
        <div
          className={`task-tree-row ${selectedTaskId === task.id ? 'active' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData('application/x-workflow-task', task.id)
            event.dataTransfer.effectAllowed = 'move'
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('application/x-workflow-task')) event.preventDefault()
          }}
          onDrop={(event) => {
            const source = event.dataTransfer.getData('application/x-workflow-task')
            if (source && source !== task.id) {
              event.preventDefault()
              onReorder(source, task.id)
            }
          }}
          onClick={() => onSelect(task.id)}
        >
          <button
            className="tree-toggle"
            type="button"
            aria-label={open ? '子タスクを閉じる' : '子タスクを開く'}
            disabled={task.children.length === 0}
            onClick={(event) => {
              event.stopPropagation()
              setExpanded((current) => {
                const next = new Set(current)
                if (next.has(task.id)) next.delete(task.id)
                else next.add(task.id)
                return next
              })
            }}
          >
            {task.children.length > 0 ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span />}
          </button>
          <span className="task-operator-dot" />
          <p><strong>{task.name.replace(/^\+/, '')}</strong><small>{task.operator ?? 'group'}</small></p>
          <GripVertical className="tree-grip" size={13} />
        </div>
        {open && renderGroup(task.id, depth + 1)}
      </div>
    )
  })

  return (
    <section className="task-tree-panel">
      <div className="sidebar-section-label-row">
        <p className="sidebar-section-label">Task tree</p>
        <span>{document.tasks.length}</span>
      </div>
      <div className="task-tree-scroll">{renderGroup('ROOT', 0)}</div>
      <div
        className="trash-dropzone"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('application/x-workflow-task')) event.preventDefault()
        }}
        onDrop={(event) => {
          const taskId = event.dataTransfer.getData('application/x-workflow-task')
          if (taskId) {
            event.preventDefault()
            onDeleteDrop(taskId)
          }
        }}
      >
        <Trash2 size={14} /> ドロップして削除（Undo可能）
      </div>
    </section>
  )
}

function FilesView({
  archive,
  selectedPath,
  draft,
  onSelect,
  onDraft,
  onSave,
}: {
  archive: WorkflowArchive
  selectedPath?: string
  draft: string
  onSelect: (file: WorkflowFile) => void
  onDraft: (value: string) => void
  onSave: () => void
}) {
  const [query, setQuery] = useState('')
  const visible = archive.files.filter((file) => file.path.toLowerCase().includes(query.toLowerCase()))
  const selected = archive.files.find((file) => file.path === selectedPath)
  return (
    <div className="files-workspace">
      <aside className="file-list-panel">
        <div className="file-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ファイルを検索" /></div>
        <div className="file-list-scroll">
          {visible.map((file) => (
            <button key={file.path} type="button" className={selectedPath === file.path ? 'active' : ''} onClick={() => onSelect(file)}>
              <span>{fileIcon(file)}</span>
              <p><strong>{file.path.split('/').at(-1)}</strong><small>{file.path}</small></p>
              <em>{formatBytes(file.bytes.byteLength)}</em>
            </button>
          ))}
        </div>
      </aside>
      <section className="file-editor-panel">
        {selected ? (
          <>
            <header>
              <div>{fileIcon(selected)}<span><strong>{selected.path.split('/').at(-1)}</strong><small>{selected.path}</small></span></div>
              {selected.text !== undefined && <button className="secondary-button" type="button" onClick={onSave}><Check size={15} /> 保存して再解析</button>}
            </header>
            {selected.text !== undefined ? (
              <textarea className="source-editor" spellCheck={false} value={draft} onChange={(event) => onDraft(event.target.value)} />
            ) : (
              <div className="binary-file-placeholder"><Box size={28} /><h3>バイナリファイル</h3><p>内容は表示・変更せず、ZIP出力時にそのまま保持されます。</p></div>
            )}
          </>
        ) : <div className="binary-file-placeholder"><FileCode2 size={28} /><h3>ファイルを選択</h3><p>.dig、SQL、JSON、YAMLを確認・編集できます。</p></div>}
      </section>
    </div>
  )
}

function DiagnosticsView({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const errors = diagnostics.filter((item) => item.severity === 'error').length
  const warnings = diagnostics.filter((item) => item.severity === 'warning').length
  return (
    <div className="content-scroll diagnostic-view">
      <header className="content-page-header">
        <div><span className="page-icon"><AlertTriangle size={20} /></span><div><p>Project health</p><h2>Diagnostics</h2></div></div>
        <div className="diagnostic-counts"><span className="error">{errors} errors</span><span className="warning">{warnings} warnings</span></div>
      </header>
      {diagnostics.length === 0 ? (
        <div className="all-clear-card"><span><ShieldCheck size={30} /></span><h3>解析上の問題は見つかりませんでした</h3><p>ブラウザ内の静的解析結果です。TD上での実行可否を保証するものではありません。</p></div>
      ) : (
        <div className="diagnostic-list">
          {diagnostics.map((item, index) => (
            <article key={`${item.code}:${item.filePath}:${index}`} className={item.severity}>
              <span>{diagnosticIcon(item)}</span>
              <div><div><strong>{item.code ?? item.severity}</strong><small>{item.filePath ?? 'project'}{item.line ? `:${item.line}` : ''}</small></div><p>{item.message}</p></div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function GuideView({ onCopy }: { onCopy: () => void }) {
  return (
    <div className="content-scroll guide-view">
      <header className="content-page-header">
        <div><span className="page-icon"><BookOpen size={20} /></span><div><p>Secure handoff</p><h2>Import Guide</h2></div></div>
      </header>
      <div className="guide-hero">
        <div><span><Sparkles size={19} /></span><h3>Treasure AI Studioから取得</h3><p>Studio内の認証済みtdxだけを使い、Workflowとソーステーブルのスキーマを含むZIPを作ります。</p></div>
        <button className="primary-button" type="button" onClick={onCopy}><Copy size={16} /> Studio用プロンプトをコピー</button>
      </div>
      <div className="guide-grid">
        <article><span>01</span><h3>Workflowを取得</h3><code>tdx wf pull &lt;project&gt;</code><p>またはTD ToolbeltのWorkflow画面からProject ZIPをダウンロードします。</p></article>
        <article><span>02</span><h3>Schemaを追加（推奨）</h3><code>tdx describe db.table --json</code><p>ソーステーブルの名前・型だけをcanonical sidecarへまとめます。行データは含めません。</p></article>
        <article><span>03</span><h3>ブラウザで解析</h3><code>workflow-project.zip</code><p>この画面へドロップします。読み込んだ内容は端末外へ送信されません。</p></article>
      </div>
      <div className="security-note"><LockKeyhole size={20} /><div><strong>ZIPへ含めないもの</strong><p>APIキー、.env、secret値、秘密鍵、Webhook URL、ログ、SQL実行結果、顧客の行データ。${'{secret:KEY}'} のような参照文字列は値を含まないため保持できます。</p></div></div>
      <section className="prompt-preview"><div><h3>Treasure AI Studio Prompt</h3><button type="button" onClick={onCopy}><Copy size={14} /> Copy</button></div><pre>{STUDIO_PROMPT}</pre></section>
    </div>
  )
}

function App() {
  const [archive, setArchive] = useState<WorkflowArchive>()
  const [projectName, setProjectName] = useState('workflow-project')
  const [view, setView] = useState<View>('pipeline')
  const [selectedWorkflowPath, setSelectedWorkflowPath] = useState<string>()
  const [selectedTaskId, setSelectedTaskId] = useState<string>()
  const [selectedFilePath, setSelectedFilePath] = useState<string>()
  const [fileDraft, setFileDraft] = useState('')
  const [graphQuery, setGraphQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [lineageSummaryOpen, setLineageSummaryOpen] = useState(false)
  const [undoStack, setUndoStack] = useState<WorkflowArchive[]>([])
  const [redoStack, setRedoStack] = useState<WorkflowArchive[]>([])
  const [toast, setToast] = useState<ToastState>()
  const importInputRef = useRef<HTMLInputElement>(null)
  const graphRef = useRef<HTMLDivElement>(null)

  const analysis = useMemo<WorkflowAnalysis | undefined>(() => archive ? analyzeWorkflow(archive) : undefined, [archive])
  const documents = useMemo(() => analysis?.documents ?? [], [analysis])
  const selectedDocument = documents.find((document) => document.path === selectedWorkflowPath) ?? documents[0]
  const effectiveSelectedTaskId = selectedTaskId && analysis?.tasks.some((item) => item.task.id === selectedTaskId)
    ? selectedTaskId
    : selectedDocument?.tasks[0]?.id
  const selectedTaskAnalysis = analysis?.tasks.find((item) => item.task.id === effectiveSelectedTaskId)
  const diagnostics = analysis?.diagnostics ?? []

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(undefined), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const commitArchive = (next: WorkflowArchive, message?: string) => {
    if (archive) setUndoStack((current) => [...current.slice(-19), cloneArchive(archive)])
    setRedoStack([])
    setArchive(next)
    if (message) setToast({ type: 'success', message })
  }

  const loadZip = async (input: File | Blob, name: string) => {
    setLoading(true)
    try {
      const loaded = await ingestWorkflowZip(input)
      if (loaded.files.every((file) => file.kind !== 'dig')) throw new Error('.digファイルがZIP内に見つかりません')
      const loadedAnalysis = analyzeWorkflow(loaded)
      setArchive(loaded)
      setProjectName(safeProjectName(name))
      setSelectedWorkflowPath(loadedAnalysis.documents[0]?.path)
      setSelectedTaskId(loadedAnalysis.documents[0]?.tasks[0]?.id)
      setSelectedFilePath(undefined)
      setGraphQuery('')
      setLineageSummaryOpen(false)
      setUndoStack([])
      setRedoStack([])
      setView('pipeline')
      setToast({ type: 'success', message: `${loaded.files.length}ファイルを端末内で読み込みました` })
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : 'ZIPを読み込めませんでした' })
    } finally {
      setLoading(false)
    }
  }

  const loadSample = async () => {
    setLoading(true)
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}examples/workflow-inspector-sample.zip`)
      if (!response.ok) throw new Error('サンプルZIPを取得できませんでした')
      await loadZip(await response.blob(), 'workflow-inspector-sample.zip')
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : 'サンプルを開けませんでした' })
      setLoading(false)
    }
  }

  const undo = () => {
    const previous = undoStack.at(-1)
    if (!previous || !archive) return
    setRedoStack((current) => [...current, cloneArchive(archive)])
    setUndoStack((current) => current.slice(0, -1))
    setArchive(previous)
    setToast({ type: 'info', message: '変更を元に戻しました' })
  }

  const redo = () => {
    const next = redoStack.at(-1)
    if (!next || !archive) return
    setUndoStack((current) => [...current, cloneArchive(archive)])
    setRedoStack((current) => current.slice(0, -1))
    setArchive(next)
    setToast({ type: 'info', message: '変更をやり直しました' })
  }

  const applyDocumentText = (documentPath: string, text: string, message: string, baseArchive = archive) => {
    if (!baseArchive) return
    commitArchive(replaceArchiveFile(baseArchive, documentPath, text), message)
  }

  const deleteTaskById = (taskId: string) => {
    if (!archive || !analysis) return
    const item = analysis.tasks.find((candidate) => candidate.task.id === taskId)
    const document = item ? analysis.documents.find((candidate) => candidate.path === item.task.documentPath) : undefined
    if (!item || !document) return
    const result = deleteDigdagTask(document, taskId)
    applyDocumentText(document.path, result.after.text, `${item.task.name} を削除しました`)
    setSelectedTaskId(item.task.parentId)
  }

  const reorderTask = (draggedId: string, targetId: string) => {
    if (!archive || !analysis) return
    const dragged = analysis.tasks.find((item) => item.task.id === draggedId)?.task
    const target = analysis.tasks.find((item) => item.task.id === targetId)?.task
    if (!dragged || !target || dragged.parentId !== target.parentId || dragged.documentPath !== target.documentPath) {
      setToast({ type: 'error', message: '同じ階層のタスク間だけ並べ替えできます' })
      return
    }
    const document = analysis.documents.find((item) => item.path === dragged.documentPath)
    if (!document) return
    const siblings = document.tasks.filter((task) => task.parentId === dragged.parentId).sort((a, b) => a.order - b.order).map((task) => task.id)
    const next = siblings.filter((id) => id !== draggedId)
    next.splice(next.indexOf(targetId), 0, draggedId)
    try {
      const result = reorderSiblingTasks(document, next)
      applyDocumentText(document.path, result.after.text, 'タスクの順序を変更しました')
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : '並べ替えに失敗しました' })
    }
  }

  const addOperator = (operator: string) => {
    if (!archive || !selectedDocument) return
    const sibling = selectedDocument.tasks.find((task) => task.id === effectiveSelectedTaskId)
      ?? selectedDocument.tasks.find((task) => task.id === selectedDocument.rootTaskIds.at(-1))
      ?? selectedDocument.tasks.at(-1)
    if (!sibling) {
      setToast({ type: 'error', message: '空のWorkflowにはソース画面から最初のタスクを追加してください' })
      return
    }
    const stemMap: Record<string, string> = {
      'td>': 'query', 'if>': 'condition', 'for_each>': 'for_each', 'call>': 'call_workflow', 'echo>': 'echo', 'py>': 'python_task',
    }
    const stem = stemMap[operator] ?? (operator.replace(/>$/, '').replace(/[^A-Za-z0-9]+/g, '_') || 'task')
    const siblings = selectedDocument.tasks.filter((task) => task.parentId === sibling.parentId)
    let sequence = 1
    let name = stem
    while (siblings.some((task) => task.name === `+${name}`)) { sequence += 1; name = `${stem}_${sequence}` }

    let value: Record<string, unknown>
    let nextArchive = archive
    if (operator === 'td>') {
      const documentDirectory = selectedDocument.path.split('/').slice(0, -1).join('/')
      let fileSequence = sequence
      let relativeSql = `queries/${name}.sql`
      let fullSql = documentDirectory ? `${documentDirectory}/${relativeSql}` : relativeSql
      while (archive.files.some((file) => file.path === fullSql)) {
        fileSequence += 1
        relativeSql = `queries/${stem}_${fileSequence}.sql`
        fullSql = documentDirectory ? `${documentDirectory}/${relativeSql}` : relativeSql
      }
      const sql = 'SELECT\n  *\nFROM source_table\n'
      const bytes = new TextEncoder().encode(sql)
      nextArchive = appendArchiveFile(archive, { path: fullSql, kind: 'sql', encoding: 'utf8', text: sql, bytes })
      value = { 'td>': relativeSql, create_table: `${name}_output`, engine: sibling.engine ?? 'presto' }
    } else if (operator === 'if>') {
      value = { 'if>': '${condition}', _do: { '+then': { 'echo>': 'condition matched' } } }
    } else if (operator === 'for_each>') {
      value = { 'for_each>': { item: ['a', 'b'] }, _do: { '+process': { 'echo>': '${item}' } } }
    } else if (operator === 'call>') value = { 'call>': 'subworkflow' }
    else if (operator === 'py>') value = { 'py>': 'tasks.WorkflowTask.run' }
    else value = { [operator]: 'New task' }

    try {
      const parsedCurrent = analyzeWorkflow(nextArchive).documents.find((document) => document.path === selectedDocument.path) ?? selectedDocument
      const currentSibling = parsedCurrent.tasks.find((task) => task.id === sibling.id) ?? parsedCurrent.tasks.at(-1)
      if (!currentSibling) throw new Error('追加位置を特定できません')
      const result = addSiblingTask(parsedCurrent, currentSibling.id, name, value)
      const updated = replaceArchiveFile(nextArchive, selectedDocument.path, result.after.text)
      commitArchive(updated, `${operator} タスクを追加しました`)
      const added = result.document.tasks.find((task) => task.name === `+${name}` && task.parentId === currentSibling.parentId)
      setSelectedTaskId(added?.id)
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : 'タスクを追加できませんでした' })
    }
  }

  const openFile = (fileOrPath: WorkflowFile | string) => {
    if (!archive) return
    const file = typeof fileOrPath === 'string' ? archive.files.find((item) => item.path === fileOrPath) : fileOrPath
    if (!file) return
    setSelectedFilePath(file.path)
    setFileDraft(file.text ?? '')
    setView('files')
  }

  const saveFile = () => {
    if (!archive || !selectedFilePath) return
    commitArchive(replaceArchiveFile(archive, selectedFilePath, fileDraft), `${selectedFilePath} を保存し、再解析しました`)
  }

  const downloadProject = () => {
    if (!archive) return
    try {
      const bytes = exportWorkflowZip(archive)
      downloadBytes(bytes, `${projectName}-edited.zip`, 'application/zip')
      setToast({ type: 'success', message: '編集済みWorkflow ZIPをダウンロードしました' })
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : 'ZIPを出力できませんでした' })
    }
  }

  const downloadLineage = () => {
    if (!analysis) return
    const payload = JSON.stringify({
      format: 'td-workflow-lineage', version: 1, project: projectName,
      tables: analysis.tableLineage,
      columns: analysis.columnLineage,
      diagnostics: analysis.diagnostics,
    }, null, 2)
    downloadBytes(new TextEncoder().encode(payload), `${projectName}-lineage.json`, 'application/json')
  }

  const graphExportLabel = view === 'pipeline' ? 'task-flow' : view === 'combined' ? 'task-data-flow' : 'table-lineage'

  const captureGraphImage = async (): Promise<string> => {
    if (!graphRef.current) throw new Error('グラフが表示されていません')
    const cleanupEdgeOverlay = createExportEdgeOverlay(graphRef.current)
    try {
      return await toPng(graphRef.current, {
        backgroundColor: '#f7f7fb',
        cacheBust: true,
        pixelRatio: 2,
        filter: (node) => {
          if (!node || typeof node.getAttribute !== 'function') return true
          const classNames = node.getAttribute('class')?.split(/\s+/) ?? []
          return !classNames.includes('react-flow__controls') &&
            !classNames.includes('react-flow__minimap') &&
            !classNames.includes('react-flow__attribution')
        },
      })
    } finally {
      cleanupEdgeOverlay()
    }
  }

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const anchor = document.createElement('a')
    anchor.href = dataUrl
    anchor.download = filename
    anchor.click()
  }

  const imageDimensions = (dataUrl: string): Promise<{ width: number; height: number }> => new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('画像サイズを取得できませんでした'))
    image.src = dataUrl
  })

  const downloadGraphPng = async () => {
    try {
      const dataUrl = await captureGraphImage()
      downloadDataUrl(dataUrl, `${projectName}-${graphExportLabel}.png`)
      setToast({ type: 'success', message: 'グラフをPNG画像で出力しました' })
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : 'PNG出力に失敗しました' })
    }
  }

  const downloadGraphPdf = async () => {
    try {
      const dataUrl = await captureGraphImage()
      const dimensions = await imageDimensions(dataUrl)
      const pdf = new jsPDF({
        orientation: dimensions.width >= dimensions.height ? 'landscape' : 'portrait',
        unit: 'pt',
        format: 'a4',
      })
      const margin = 24
      const titleHeight = 20
      const pageWidth = pdf.internal.pageSize.getWidth() - margin * 2
      const pageHeight = pdf.internal.pageSize.getHeight() - margin * 2 - titleHeight
      const scale = Math.min(pageWidth / dimensions.width, pageHeight / dimensions.height)
      const width = dimensions.width * scale
      const height = dimensions.height * scale
      pdf.setFontSize(12)
      pdf.text(`${projectName} — ${graphExportLabel}`, margin, margin + 12)
      pdf.addImage(dataUrl, 'PNG', margin + (pageWidth - width) / 2, margin + titleHeight, width, height)
      pdf.save(`${projectName}-${graphExportLabel}.pdf`)
      setToast({ type: 'success', message: 'グラフをPDFで出力しました' })
    } catch (error) {
      setToast({ type: 'error', message: error instanceof Error ? error.message : 'PDF出力に失敗しました' })
    }
  }

  const copyStudioPrompt = async () => {
    try {
      await navigator.clipboard.writeText(STUDIO_PROMPT)
      setToast({ type: 'success', message: 'Treasure AI Studio用プロンプトをコピーしました' })
    } catch {
      setToast({ type: 'error', message: 'クリップボードにコピーできませんでした' })
    }
  }

  if (!archive || !analysis) {
    return (
      <>
        <ImportScreen onFile={(file) => loadZip(file, file.name)} onSample={loadSample} loading={loading} />
        {toast && <div className={`toast toast-${toast.type}`}>{toast.type === 'success' ? <Check size={17} /> : toast.type === 'error' ? <AlertTriangle size={17} /> : <Info size={17} />}<span>{toast.message}</span></div>}
      </>
    )
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <img src={`${import.meta.env.BASE_URL}brand/treasure-ai-master-logo.svg`} alt="Treasure AI" />
          {!sidebarCollapsed && <><span /><p><strong>Workflow</strong><small>Visual Editor</small></p></>}
        </div>
        <SidebarNav view={view} onView={setView} diagnostics={diagnostics.length} collapsed={sidebarCollapsed} />
        {!sidebarCollapsed && (view === 'pipeline' || view === 'combined') && <OperatorPalette onAddOperator={addOperator} />}
        {!sidebarCollapsed && (view === 'pipeline' || view === 'combined') && (
          <TaskTree key={selectedDocument?.path} document={selectedDocument} selectedTaskId={effectiveSelectedTaskId} onSelect={setSelectedTaskId} onReorder={reorderTask} onDeleteDrop={deleteTaskById} />
        )}
        <div className="sidebar-privacy"><LockKeyhole size={15} />{!sidebarCollapsed && <span><strong>Local processing</strong><small>No API connection</small></span>}</div>
      </aside>

      <main className="workspace-main">
        <header className="workspace-header">
          <div className="header-left">
            <button className="icon-button" type="button" onClick={() => setSidebarCollapsed((value) => !value)} title="サイドバー切替">
              {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            </button>
            <div className="project-identity">
              <p><span className="project-identity-context">Workflow Catalog</span><i>/</i>{view === 'pipeline' ? 'Task Flow' : view === 'combined' ? 'Task + Data Flow' : view === 'lineage' ? 'Data Lineage' : view === 'files' ? 'Project Files' : view === 'diagnostics' ? 'Diagnostics' : 'Import Guide'}</p>
              <h1>{projectName}</h1>
            </div>
            {(view === 'pipeline' || view === 'combined' || view === 'lineage') && documents.length > 0 && (
              <label className="workflow-select"><GitFork size={14} /><select value={selectedDocument?.path} onChange={(event) => { setSelectedWorkflowPath(event.target.value); setSelectedTaskId(undefined) }}>{documents.map((document) => <option key={document.path} value={document.path}>{document.path}</option>)}</select><ChevronDown size={13} /></label>
            )}
          </div>
          <div className="header-actions">
            <div className="history-actions"><button className="icon-button" type="button" title="Undo" disabled={undoStack.length === 0} onClick={undo}><Undo2 size={17} /></button><button className="icon-button" type="button" title="Redo" disabled={redoStack.length === 0} onClick={redo}><Redo2 size={17} /></button></div>
            <button className="secondary-button" type="button" title="別のWorkflow ZIPを読み込む" aria-label="別のWorkflow ZIPを読み込む" onClick={() => importInputRef.current?.click()}><Upload size={16} /> 別のZIP</button>
            {(view === 'combined' || view === 'lineage') && <button className="secondary-button" type="button" title="Lineage JSONを出力" aria-label="Lineage JSONを出力" onClick={downloadLineage}><ArrowDownToLine size={16} /> Lineage JSON</button>}
            {(view === 'pipeline' || view === 'combined' || view === 'lineage') && <>
              <button className="secondary-button" type="button" title="グラフをPNGで出力" aria-label="グラフをPNGで出力" onClick={downloadGraphPng}><ImageDown size={16} /> PNG</button>
              <button className="secondary-button" type="button" title="グラフをPDFで出力" aria-label="グラフをPDFで出力" onClick={downloadGraphPdf}><FileDown size={16} /> PDF</button>
            </>}
            <button className="primary-button" type="button" onClick={downloadProject}><Download size={16} /> Project ZIP</button>
            <input ref={importInputRef} className="visually-hidden" type="file" accept=".zip,application/zip" onChange={(event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) loadZip(file, file.name) }} />
          </div>
        </header>

        <div className="workspace-statusbar">
          <span className="privacy-status"><ShieldCheck size={13} /> Browser-only</span>
          <span>{archive.files.length} files</span><i />
          <span>{analysis.documents.length} workflows</span><i />
          <span>{analysis.tasks.length} tasks</span><i />
          <span>{analysis.tableLineage.length} lineage edges</span>
          <div className="status-spacer" />
          <span className={diagnostics.some((item) => item.severity !== 'info') ? 'status-error' : 'status-ok'}>{diagnostics.some((item) => item.severity !== 'info') ? <AlertTriangle size={13} /> : <Check size={13} />}{diagnostics.some((item) => item.severity !== 'info') ? 'Review needed' : 'Parsed successfully'}</span>

        </div>

        <section className="workspace-content">
          {(view === 'pipeline' || view === 'combined' || view === 'lineage') && (
            <div className="graph-workspace">
              <div className="graph-filter-strip" aria-label="Catalog filters">
                {['Data Assets', 'Domains', 'Tier', 'Tags', 'Certification', 'Service', 'Service Type'].map((filter) => (
                  <span className="graph-filter-chip" key={filter}>{filter}<ChevronDown size={12} /></span>
                ))}
              </div>
              <div className="graph-toolbar">
                <div className="graph-view-tabs" role="tablist" aria-label="Workflow visualization mode">
                  <button type="button" role="tab" aria-selected={view === 'pipeline'} className={view === 'pipeline' ? 'active' : ''} onClick={() => setView('pipeline')}><ListTree size={15} /> タスクの流れ</button>
                  <button type="button" role="tab" aria-selected={view === 'combined'} className={view === 'combined' ? 'active' : ''} onClick={() => setView('combined')}><GitFork size={15} /> タスク＋データの流れ</button>
                  <button type="button" role="tab" aria-selected={view === 'lineage'} className={view === 'lineage' ? 'active' : ''} onClick={() => setView('lineage')}><TableProperties size={15} /> テーブルリネージ</button>
                </div>
                <label className="graph-search"><Search size={14} /><input value={graphQuery} onChange={(event) => setGraphQuery(event.target.value)} placeholder="ノード・テーブル・カラムを検索" aria-label="グラフを検索" />{graphQuery && <button type="button" aria-label="検索をクリア" onClick={() => setGraphQuery('')}><X size={12} /></button>}</label>
                {(view === 'combined' || view === 'lineage') && <button className={`lineage-summary-toggle ${lineageSummaryOpen ? 'active' : ''}`} type="button" aria-pressed={lineageSummaryOpen} onClick={() => setLineageSummaryOpen((current) => !current)}>{lineageSummaryOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />} Summary</button>}
                <p>{view === 'pipeline' ? `${selectedDocument?.tasks.length ?? 0} tasks` : `${analysis.tableLineage.length} lineage connections`}</p>
                <span className="graph-legend">{view === 'lineage' ? <><i className="data" /> Data flow</> : <><i className="query" /> Query <i className="control" /> Control {view === 'combined' && <><i className="data" /> Data flow</>}</>}</span>
              </div>
              <div className={`graph-and-inspector ${(view === 'combined' || view === 'lineage') && !lineageSummaryOpen ? 'graph-full-width' : ''}`}>
                <WorkflowGraph mode={view === 'pipeline' ? 'pipeline' : view === 'combined' ? 'combined' : 'lineage'} analysis={analysis} document={selectedDocument} selectedTaskId={effectiveSelectedTaskId} onSelectTask={setSelectedTaskId} onDropOperator={addOperator} canvasRef={graphRef} searchQuery={graphQuery} />
                {view === 'pipeline' && <TaskInspector analysis={selectedTaskAnalysis} schemas={analysis.schemas} onDelete={() => effectiveSelectedTaskId && deleteTaskById(effectiveSelectedTaskId)} onOpenFile={openFile} />}
                {(view === 'combined' || view === 'lineage') && lineageSummaryOpen && (
                  <aside className="lineage-summary-panel">
                    <div className="lineage-summary-header"><Database size={18} /><div><p>Lineage summary</p><h2>{analysis.tableLineage.length} connections</h2></div></div>
                    <div className="lineage-metrics"><div><strong>{new Set(analysis.tableLineage.map((item) => item.source.qualifiedName)).size}</strong><small>Source tables</small></div><div><strong>{new Set(analysis.tableLineage.map((item) => item.target.qualifiedName)).size}</strong><small>Output tables</small></div><div><strong>{analysis.columnLineage.length}</strong><small>Column mappings</small></div></div>
                    <section><h3>Data flow</h3>{analysis.tableLineage.map((item, index) => <div className="lineage-list-item" key={`${item.source.qualifiedName}:${item.target.qualifiedName}:${index}`}><span>{item.source.qualifiedName}</span><ChevronRight size={13} /><strong>{item.target.qualifiedName}</strong><small className={`confidence-${item.confidence}`}>{item.confidence}</small></div>)}</section>
                  </aside>
                )}
              </div>
            </div>
          )}
          {view === 'files' && <FilesView archive={archive} selectedPath={selectedFilePath} draft={fileDraft} onSelect={openFile} onDraft={setFileDraft} onSave={saveFile} />}
          {view === 'diagnostics' && <DiagnosticsView diagnostics={diagnostics} />}
          {view === 'guide' && <GuideView onCopy={copyStudioPrompt} />}
        </section>
      </main>

      {toast && <div className={`toast toast-${toast.type}`}>{toast.type === 'success' ? <Check size={17} /> : toast.type === 'error' ? <AlertTriangle size={17} /> : <Info size={17} />}<span>{toast.message}</span></div>}
      {loading && <div className="loading-overlay"><LoaderCircle className="spin" size={28} /><strong>ZIPを端末内で解析中...</strong></div>}
    </div>
  )
}

export default App
