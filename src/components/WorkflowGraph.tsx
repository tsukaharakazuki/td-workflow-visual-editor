import { useMemo, useState, type RefObject } from 'react'
import dagre from '@dagrejs/dagre'
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react'
import { Braces, ChevronDown, Database, EllipsisVertical, GitBranch, Layers3, Network, Repeat2, Search, Table2 } from 'lucide-react'
import type {
  DigdagDocument,
  DigdagTaskNode,
  SchemaTable,
  WorkflowAnalysis,
} from '../types'

type GraphMode = 'pipeline' | 'combined' | 'lineage'

interface WorkflowGraphProps {
  mode: GraphMode
  analysis: WorkflowAnalysis
  document?: DigdagDocument
  selectedTaskId?: string
  onSelectTask: (taskId: string) => void
  onDropOperator: (operator: string) => void
  canvasRef?: RefObject<HTMLDivElement | null>
  searchQuery?: string
}

const NODE_WIDTH = 260
const NODE_HEIGHT = 112
const TABLE_WIDTH = 310
const TABLE_HEIGHT = 274

function operatorLabel(task: DigdagTaskNode): string {
  if (task.operator === '_parallel') return 'Parallel group'
  return task.operator ?? 'Group'
}

function operatorTone(operator?: string): string {
  if (operator === 'td>' || operator === 'td_ddl>' || operator === 'td_run>') return 'query'
  if (operator === 'if>' || operator === 'for_each>' || operator === 'loop>') return 'control'
  if (operator === 'call>' || operator === 'require>') return 'reference'
  if (operator === 'py>') return 'script'
  return 'neutral'
}

function OperatorIcon({ operator }: { operator?: string }) {
  if (operator === 'td>' || operator === 'td_ddl>' || operator === 'td_run>') return <Database size={16} />
  if (operator === 'if>') return <GitBranch size={16} />
  if (operator === 'for_each>' || operator === 'loop>') return <Repeat2 size={16} />
  if (operator === 'call>' || operator === 'require>') return <Layers3 size={16} />
  return <Braces size={16} />
}

function taskLabel(task: DigdagTaskNode) {
  return (
    <div className="graph-task-label">
      <div className="graph-task-header">
        <span className={`graph-task-icon tone-${operatorTone(task.operator)}`}>
          <OperatorIcon operator={task.operator} />
        </span>
        <span className="graph-task-copy">
          <span className="graph-entity-kicker"><small>Workflow</small><i>·</i><small>Task</small></span>
          <strong>{task.name.replace(/^\+/, '')}</strong>
        </span>
        <EllipsisVertical size={15} className="graph-entity-menu" />
      </div>
      <div className="graph-task-details">
        <code>{operatorLabel(task)}</code>
        <span title={task.documentPath}>{task.documentPath}</span>
      </div>
    </div>
  )
}

function schemaTableFor(name: string, analysis: WorkflowAnalysis): SchemaTable | undefined {
  const normalized = name.toLowerCase()
  return analysis.schemas
    .flatMap((schema) => schema.tables)
    .find((table) => table.qualifiedName.toLowerCase() === normalized || table.name.toLowerCase() === normalized)
}

function TableLabel({ name, analysis }: { name: string; analysis: WorkflowAnalysis }) {
  const schema = schemaTableFor(name, analysis)
  const [columnQuery, setColumnQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const parts = name.split('.')
  const tableName = schema?.name ?? parts.at(-1) ?? name
  const serviceName = schema?.database ?? (parts.slice(0, -1).join('.') || 'Workflow')
  const allColumns = schema?.columns ?? []
  const filteredColumns = allColumns.filter((column) => `${column.name} ${column.type ?? ''}`.toLowerCase().includes(columnQuery.trim().toLowerCase()))
  const columns = columnQuery || expanded ? filteredColumns : filteredColumns.slice(0, 5)
  const remaining = filteredColumns.length - columns.length

  return (
    <div className="graph-table-label">
      <div className="graph-table-title">
        <span><Database size={18} /></span>
        <div><small>{serviceName} <i>·</i> <Table2 size={9} /> Table</small><strong title={name}>{tableName}</strong></div>
        <EllipsisVertical size={16} className="graph-entity-menu" />
      </div>
      <div className="graph-table-body">
        <div className="graph-table-actions">
          <button className="nodrag nopan graph-column-count" type="button" onClick={(event) => { event.stopPropagation(); setExpanded((current) => !current) }}>
            {allColumns.length} Columns <ChevronDown size={11} className={expanded ? 'is-open' : ''} />
          </button>
          <span title="Column lineage"><Network size={13} /></span>
        </div>
        <label className="nodrag nopan graph-column-search" onClick={(event) => event.stopPropagation()}>
          <Search size={13} />
          <input value={columnQuery} onChange={(event) => setColumnQuery(event.target.value)} onMouseDown={(event) => event.stopPropagation()} placeholder="Search Column" aria-label={`${tableName}のカラムを検索`} />
        </label>
        <div className="graph-table-columns">
          {columns.length > 0 ? columns.map((column) => (
            <div key={column.name}>
              <i />
              <span title={column.name}>{column.name}</span>
              <small>{column.type ?? 'unknown'}</small>
            </div>
          )) : <p>{allColumns.length > 0 ? '一致するカラムがありません' : 'スキーマ情報なし'}</p>}
        </div>
        {remaining > 0 && (
          <button className="nodrag nopan graph-show-columns" type="button" onClick={(event) => { event.stopPropagation(); setExpanded(true) }}>Show {remaining} More Columns</button>
        )}
        {expanded && !columnQuery && allColumns.length > 5 && (
          <button className="nodrag nopan graph-show-columns" type="button" onClick={(event) => { event.stopPropagation(); setExpanded(false) }}>Show Less</button>
        )}
      </div>
    </div>
  )
}

interface GraphNodeSize {
  width: number
  height: number
}

function searchClass(value: string, query: string): string {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return ''
  return value.toLowerCase().includes(normalized) ? ' is-search-match' : ' is-search-muted'
}

function tableSearchValue(name: string, analysis: WorkflowAnalysis): string {
  const schema = schemaTableFor(name, analysis)
  return [name, ...(schema?.columns.map((column) => `${column.name} ${column.type ?? ''}`) ?? [])].join(' ')
}

function layoutGraph(
  nodes: Node[],
  edges: Edge[],
  size: GraphNodeSize | ((node: Node) => GraphNodeSize),
  direction: 'LR' | 'TB',
): Node[] {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({
    rankdir: direction,
    nodesep: direction === 'TB' ? 44 : 96,
    ranksep: direction === 'TB' ? 72 : 160,
    marginx: 44,
    marginy: 44,
  })
  graph.setDefaultEdgeLabel(() => ({}))
  const dimensions = new Map<string, GraphNodeSize>()
  nodes.forEach((node) => {
    const nodeSize = typeof size === 'function' ? size(node) : size
    const copiedSize = { ...nodeSize }
    // Dagre mutates node objects with x/y/rank. Keep each node's dimensions isolated.
    dimensions.set(node.id, copiedSize)
    graph.setNode(node.id, { ...copiedSize })
  })
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target))
  dagre.layout(graph)
  return nodes.map((node) => {
    const position = graph.node(node.id)
    const nodeSize = dimensions.get(node.id) ?? (typeof size === 'function' ? size(node) : size)
    return {
      ...node,
      position: {
        x: position.x - nodeSize.width / 2,
        y: position.y - nodeSize.height / 2,
      },
    }
  })
}

function taskElements(
  analysis: WorkflowAnalysis,
  document: DigdagDocument | undefined,
  selectedTaskId: string | undefined,
  searchQuery: string,
): { nodes: Node[]; edges: Edge[] } {
  if (!document) return { nodes: [], edges: [] }
  const ids = new Set(document.tasks.map((task) => task.id))
  const nodes: Node[] = document.tasks.map((task) => ({
    id: task.id,
    position: { x: 0, y: 0 },
    data: { label: taskLabel(task) },
    className: `workflow-node tone-${operatorTone(task.operator)}${selectedTaskId === task.id ? ' is-selected' : ''}${searchClass(`${task.name} ${operatorLabel(task)} ${task.documentPath} ${task.database ?? ''}`, searchQuery)}`,
    style: { width: NODE_WIDTH, minHeight: NODE_HEIGHT },
  }))
  const edgeKeys = new Set<string>()
  const edges: Edge[] = []
  const addEdge = (source: string, target: string, kind: string, label?: string) => {
    if (!ids.has(source) || !ids.has(target)) return
    const key = `${source}:${target}:${kind}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({
      id: key,
      source,
      target,
      type: kind === 'sequence' ? 'smoothstep' : 'default',
      label,
      className: `workflow-edge edge-${kind}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    })
  }
  // A task-only view intentionally omits table edges. The combined view adds
  // explicit table nodes and task/table edges below instead of hiding data flow
  // inside a task-to-task edge.
  analysis.edges.forEach((edge) => {
    if (edge.kind !== 'table') addEdge(edge.from, edge.to, edge.kind)
  })
  document.tasks.forEach((task) => {
    if (task.parentId) addEdge(task.parentId, task.id, 'contains')
  })
  return { nodes, edges }
}

function pipelineElements(
  analysis: WorkflowAnalysis,
  document: DigdagDocument | undefined,
  selectedTaskId: string | undefined,
  searchQuery: string,
): { nodes: Node[]; edges: Edge[] } {
  const elements = taskElements(analysis, document, selectedTaskId, searchQuery)
  return { ...elements, nodes: layoutGraph(elements.nodes, elements.edges, { width: NODE_WIDTH, height: NODE_HEIGHT }, 'TB') }
}

function combinedElements(
  analysis: WorkflowAnalysis,
  document: DigdagDocument | undefined,
  selectedTaskId: string | undefined,
  selectedDataNodeId: string | undefined,
  searchQuery: string,
): { nodes: Node[]; edges: Edge[] } {
  const taskGraph = taskElements(analysis, document, selectedTaskId, searchQuery)
  if (!document) return taskGraph

  const taskIds = new Set(document.tasks.map((task) => task.id))
  const taskAnalyses = analysis.tasks.filter((item) => taskIds.has(item.task.id) && item.sql)
  const tableNames = new Map<string, string>()
  const tableIdFor = (name: string) => {
    const key = name.toLowerCase()
    if (!tableNames.has(key)) tableNames.set(key, name)
    return `table:${key}`
  }

  taskAnalyses.forEach((item) => {
    item.sql?.sources.forEach((source) => tableIdFor(source.qualifiedName))
    item.sql?.targets.forEach((target) => tableIdFor(target.qualifiedName))
  })

  const tableNodes: Node[] = [...tableNames.entries()].map(([key, name]) => ({
    id: `table:${key}`,
    position: { x: 0, y: 0 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: { label: <TableLabel name={name} analysis={analysis} /> },
    className: `lineage-table-node workflow-data-node${selectedDataNodeId === `table:${key}` ? ' is-selected' : ''}${searchClass(tableSearchValue(name, analysis), searchQuery)}`,
    style: { width: TABLE_WIDTH, minHeight: TABLE_HEIGHT },
  }))
  const edges = [...taskGraph.edges]
  const edgeKeys = new Set(edges.map((edge) => edge.id))
  const addDataEdge = (source: string, target: string, label: string) => {
    const key = `data:${source}:${target}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({
      id: key,
      source,
      target,
      type: 'default',
      label,
      className: 'workflow-edge edge-data',
      markerEnd: { type: MarkerType.ArrowClosed, width: 17, height: 17 },
    })
  }

  taskAnalyses.forEach((item) => {
    item.sql?.sources.forEach((source) => {
      addDataEdge(tableIdFor(source.qualifiedName), item.task.id, 'input')
    })
    item.sql?.targets.forEach((target) => {
      addDataEdge(item.task.id, tableIdFor(target.qualifiedName), 'output')
    })
  })

  const nodes = [...taskGraph.nodes, ...tableNodes]
  return {
    nodes: layoutGraph(
      nodes,
      edges,
      (node) => node.id.startsWith('table:')
        ? { width: TABLE_WIDTH, height: TABLE_HEIGHT }
        : { width: NODE_WIDTH, height: NODE_HEIGHT },
      'TB',
    ),
    edges,
  }
}

function lineageElements(analysis: WorkflowAnalysis, selectedDataNodeId: string | undefined, searchQuery: string): { nodes: Node[]; edges: Edge[] } {
  const names = new Set<string>()
  analysis.tableLineage.forEach((record) => {
    names.add(record.source.qualifiedName)
    names.add(record.target.qualifiedName)
  })
  const nodes: Node[] = [...names].map((name) => ({
    id: `table:${name}`,
    position: { x: 0, y: 0 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: { label: <TableLabel name={name} analysis={analysis} /> },
    className: `lineage-table-node${selectedDataNodeId === `table:${name}` ? ' is-selected' : ''}${searchClass(tableSearchValue(name, analysis), searchQuery)}`,
    style: { width: TABLE_WIDTH, minHeight: TABLE_HEIGHT },
  }))
  const taskById = new Map(analysis.tasks.map((item) => [item.task.id, item.task]))
  const edges: Edge[] = analysis.tableLineage.map((record, index) => ({
    id: `lineage:${index}:${record.source.qualifiedName}:${record.target.qualifiedName}`,
    source: `table:${record.source.qualifiedName}`,
    target: `table:${record.target.qualifiedName}`,
    label: record.taskId ? taskById.get(record.taskId)?.name.replace(/^\+/, '') : undefined,
    type: 'default',
    className: `lineage-edge confidence-${record.confidence}`,
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
  }))
  return { nodes: layoutGraph(nodes, edges, { width: TABLE_WIDTH, height: TABLE_HEIGHT }, 'LR'), edges }
}

export function WorkflowGraph({
  mode,
  analysis,
  document,
  selectedTaskId,
  onSelectTask,
  onDropOperator,
  canvasRef,
  searchQuery = '',
}: WorkflowGraphProps) {
  const [selectedDataNodeId, setSelectedDataNodeId] = useState<string>()
  const elements = useMemo(
    () => mode === 'pipeline'
      ? pipelineElements(analysis, document, selectedTaskId, searchQuery)
      : mode === 'combined'
        ? combinedElements(analysis, document, selectedTaskId, selectedDataNodeId, searchQuery)
        : lineageElements(analysis, selectedDataNodeId, searchQuery),
    [analysis, document, mode, searchQuery, selectedDataNodeId, selectedTaskId],
  )

  if (elements.nodes.length === 0) {
    return (
      <div
        ref={canvasRef}
        className="graph-empty"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault()
          const operator = event.dataTransfer.getData('application/x-workflow-operator')
          if (operator) onDropOperator(operator)
        }}
      >
        <span><GitBranch size={30} /></span>
        <h3>{mode === 'pipeline' ? '表示できるタスクがありません' : mode === 'combined' ? 'タスクとデータの流れが見つかりません' : 'テーブルのデータリネージが見つかりません'}</h3>
        <p>{mode === 'pipeline' ? '有効な .dig ファイルを選択してください。' : mode === 'combined' ? '有効なタスク、またはSQLの入力・出力テーブルを確認してください。' : 'SQLの入力テーブルと出力テーブルを確認してください。'}</p>
      </div>
    )
  }

  return (
    <div
      ref={canvasRef}
      className="graph-canvas"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('application/x-workflow-operator')) {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(event) => {
        const operator = event.dataTransfer.getData('application/x-workflow-operator')
        if (!operator) return
        event.preventDefault()
        onDropOperator(operator)
      }}
    >
      <ReactFlow
        nodes={elements.nodes}
        edges={elements.edges}
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: mode === 'pipeline' ? 0.32 : mode === 'combined' ? 0.34 : 0.45, maxZoom: 1.15 }}
        minZoom={0.2}
        maxZoom={1.8}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, node) => {
          if (mode === 'pipeline' || node.id.startsWith('task:')) onSelectTask(node.id)
          else setSelectedDataNodeId(node.id)
        }}
      >
        <Background gap={24} size={1.1} color="#d6dee8" />
        <MiniMap
          pannable
          zoomable
          nodeStrokeWidth={2}
          nodeColor={(node) => node.className?.toString().includes('lineage-table-node') ? '#3f879a' : node.className?.toString().includes('query') ? '#4d79ad' : '#75889f'}
          maskColor="rgba(247,249,252,.82)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
