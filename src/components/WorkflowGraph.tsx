import { Fragment, useMemo, useState, type ReactNode, type RefObject } from 'react'
import dagre from '@dagrejs/dagre'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { Braces, ChevronDown, Database, EllipsisVertical, GitBranch, Layers3, Network, Repeat2, Search, Table2 } from 'lucide-react'
import type {
  DigdagDocument,
  DigdagTaskNode,
  SchemaTable,
  SqlTableReference,
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
/** Horizontal gap between sibling subtrees laid out left to right. */
const COLUMN_GAP = 88
/** Vertical gap between depth bands. Child tasks sit one band below the parent. */
const ROW_GAP = 108
/** Gap between a task card and the table cards attached to its sides. */
const TABLE_GAP = 64
/** Vertical gap between table cards stacked on the same side of a task. */
const TABLE_STACK_GAP = 30
const CANVAS_MARGIN = 48

/** Every card exposes source and target handles on all four sides. */
const ANCHOR_SIDES = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const

function AnchoredNode({ data }: NodeProps) {
  const label = (data as { label?: ReactNode }).label
  return (
    <>
      {ANCHOR_SIDES.map((side) => (
        <Fragment key={side}>
          <Handle className="graph-anchor" id={`${side}-target`} type="target" position={side} isConnectable={false} />
          <Handle className="graph-anchor" id={`${side}-source`} type="source" position={side} isConnectable={false} />
        </Fragment>
      ))}
      {label}
    </>
  )
}

const nodeTypes = { anchored: AnchoredNode }

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

/**
 * Table names written with `${...}` are resolved before they reach the graph.
 * This keeps the original expression so a card can show where its name came from.
 */
function templatesByTable(analysis: WorkflowAnalysis): Map<string, string> {
  const templates = new Map<string, string>()
  const add = (reference: SqlTableReference) => {
    const key = reference.qualifiedName.toLowerCase()
    if (reference.template && !templates.has(key)) templates.set(key, reference.template)
  }
  analysis.tasks.forEach((item) => {
    item.sql?.sources.forEach(add)
    item.sql?.targets.forEach(add)
  })
  analysis.tableLineage.forEach((record) => {
    add(record.source)
    add(record.target)
  })
  return templates
}

function schemaTableFor(name: string, analysis: WorkflowAnalysis): SchemaTable | undefined {
  const normalized = name.toLowerCase()
  return analysis.schemas
    .flatMap((schema) => schema.tables)
    .find((table) => table.qualifiedName.toLowerCase() === normalized || table.name.toLowerCase() === normalized)
}

function TableLabel({ name, analysis, template }: { name: string; analysis: WorkflowAnalysis; template?: string }) {
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
        <div>
          <small>{serviceName} <i>·</i> <Table2 size={9} /> Table</small>
          <strong title={name}>{tableName}</strong>
          {template && <em className="graph-table-template" title={`変数定義: ${template}`}>{template}</em>}
        </div>
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

interface GraphRect extends GraphNodeSize {
  x: number
  y: number
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

interface SubtreeMeasure {
  /** Width of the whole subtree, including the tables attached to each task. */
  width: number
  /** Offset of the task card itself inside the subtree. */
  taskOffset: number
  /** Offset of the task's own row (tables + card) inside the subtree. */
  ownOffset: number
  /** Offset of the children row inside the subtree. */
  childrenOffset: number
  /** Offset of each child subtree inside the children row. */
  childOffsets: number[]
  /** Height of the task's own row, tables included. */
  height: number
  leftWidth: number
}

interface HierarchyInput {
  tasks: readonly DigdagTaskNode[]
  rootIds: readonly string[]
  inputTables: Map<string, string[]>
  outputTables: Map<string, string[]>
}

function stackHeight(count: number): number {
  return count === 0 ? 0 : count * TABLE_HEIGHT + (count - 1) * TABLE_STACK_GAP
}

/**
 * Lays the task tree out as a left-to-right flow: siblings run rightwards from
 * the left-hand origin, and every child task sits in the band directly below
 * its parent card. Tables attached to a task are placed inline — inputs to the
 * left of the card, outputs to the right — so data reads left to right too.
 */
function hierarchicalLayout({ tasks, rootIds, inputTables, outputTables }: HierarchyInput): Map<string, GraphRect> {
  const rects = new Map<string, GraphRect>()
  const byId = new Map(tasks.map((task) => [task.id, task]))
  if (byId.size === 0) return rects

  const childIdsOf = (id: string): string[] => (byId.get(id)?.children ?? [])
    .filter((childId) => byId.has(childId))
    .sort((left, right) => (byId.get(left)?.order ?? 0) - (byId.get(right)?.order ?? 0))

  const measures = new Map<string, SubtreeMeasure>()
  const measure = (id: string): SubtreeMeasure => {
    const cached = measures.get(id)
    if (cached) return cached
    const inputs = inputTables.get(id)?.length ?? 0
    const outputs = outputTables.get(id)?.length ?? 0
    const leftWidth = inputs > 0 ? TABLE_WIDTH + TABLE_GAP : 0
    const rightWidth = outputs > 0 ? TABLE_WIDTH + TABLE_GAP : 0
    const ownWidth = leftWidth + NODE_WIDTH + rightWidth
    const height = Math.max(NODE_HEIGHT, stackHeight(inputs), stackHeight(outputs))

    const childMeasures = childIdsOf(id).map((childId) => measure(childId))
    const childOffsets: number[] = []
    let childrenRowWidth = 0
    childMeasures.forEach((child, index) => {
      if (index > 0) childrenRowWidth += COLUMN_GAP
      childOffsets.push(childrenRowWidth)
      childrenRowWidth += child.width
    })

    // Align the parent card with its first child so the containment arrow drops
    // straight down instead of skewing across the band.
    let ownOffset = 0
    let childrenOffset = 0
    if (childMeasures.length > 0) {
      const delta = leftWidth - (childOffsets[0] + childMeasures[0].taskOffset)
      if (delta >= 0) childrenOffset = delta
      else ownOffset = -delta
    }

    const result: SubtreeMeasure = {
      width: Math.max(ownOffset + ownWidth, childrenOffset + childrenRowWidth),
      taskOffset: ownOffset + leftWidth,
      ownOffset,
      childrenOffset,
      childOffsets,
      height,
      leftWidth,
    }
    measures.set(id, result)
    return result
  }

  const roots = rootIds.filter((id) => byId.has(id))
  const effectiveRoots = roots.length > 0
    ? roots
    : tasks.filter((task) => !task.parentId || !byId.has(task.parentId)).map((task) => task.id)

  const rowHeights: number[] = []
  const collectRow = (id: string, depth: number) => {
    rowHeights[depth] = Math.max(rowHeights[depth] ?? 0, measure(id).height)
    childIdsOf(id).forEach((childId) => collectRow(childId, depth + 1))
  }
  effectiveRoots.forEach((id) => collectRow(id, 0))

  const rowY: number[] = []
  rowHeights.forEach((_, depth) => {
    rowY[depth] = depth === 0 ? CANVAS_MARGIN : rowY[depth - 1] + rowHeights[depth - 1] + ROW_GAP
  })

  const place = (id: string, originX: number, depth: number) => {
    const item = measure(id)
    const bandCenter = rowY[depth] + rowHeights[depth] / 2
    const taskX = originX + item.taskOffset
    rects.set(id, { x: taskX, y: bandCenter - NODE_HEIGHT / 2, width: NODE_WIDTH, height: NODE_HEIGHT })

    const placeStack = (tableIds: readonly string[], x: number) => {
      let y = bandCenter - stackHeight(tableIds.length) / 2
      tableIds.forEach((tableId) => {
        rects.set(tableId, { x, y, width: TABLE_WIDTH, height: TABLE_HEIGHT })
        y += TABLE_HEIGHT + TABLE_STACK_GAP
      })
    }
    const inputs = inputTables.get(id) ?? []
    const outputs = outputTables.get(id) ?? []
    if (inputs.length > 0) placeStack(inputs, originX + item.ownOffset)
    if (outputs.length > 0) placeStack(outputs, taskX + NODE_WIDTH + TABLE_GAP)

    childIdsOf(id).forEach((childId, index) => {
      place(childId, originX + item.childrenOffset + item.childOffsets[index], depth + 1)
    })
  }

  let cursor = CANVAS_MARGIN
  effectiveRoots.forEach((id) => {
    place(id, cursor, 0)
    cursor += measure(id).width + COLUMN_GAP
  })

  return rects
}

function applyRects(nodes: Node[], rects: Map<string, GraphRect>): Node[] {
  return nodes.map((node) => {
    const rect = rects.get(node.id)
    return rect ? { ...node, position: { x: rect.x, y: rect.y } } : node
  })
}

function nodeRects(nodes: Node[]): Map<string, GraphRect> {
  const rects = new Map<string, GraphRect>()
  nodes.forEach((node) => {
    const width = Number(node.style?.width ?? NODE_WIDTH)
    const height = Number(node.style?.minHeight ?? node.style?.height ?? NODE_HEIGHT)
    rects.set(node.id, { x: node.position.x, y: node.position.y, width, height })
  })
  return rects
}

/**
 * Picks which of the four sides an edge leaves and enters. Containment edges
 * always drop out of the bottom of the parent so the hierarchy reads downwards.
 */
function anchorSides(source: GraphRect, target: GraphRect, forceVertical: boolean): { source: Position; target: Position } {
  const dx = (target.x + target.width / 2) - (source.x + source.width / 2)
  const dy = (target.y + target.height / 2) - (source.y + source.height / 2)
  if (forceVertical || Math.abs(dy) > Math.abs(dx)) {
    return dy >= 0
      ? { source: Position.Bottom, target: Position.Top }
      : { source: Position.Top, target: Position.Bottom }
  }
  return dx >= 0
    ? { source: Position.Right, target: Position.Left }
    : { source: Position.Left, target: Position.Right }
}

function assignEdgeAnchors(nodes: Node[], edges: Edge[]): Edge[] {
  const rects = nodeRects(nodes)
  return edges.map((edge) => {
    const source = rects.get(edge.source)
    const target = rects.get(edge.target)
    if (!source || !target) return edge
    const forceVertical = typeof edge.className === 'string' && edge.className.includes('edge-contains')
    const sides = anchorSides(source, target, forceVertical)
    return { ...edge, sourceHandle: `${sides.source}-source`, targetHandle: `${sides.target}-target` }
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
    type: 'anchored',
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
      type: kind === 'sequence' || kind === 'contains' ? 'smoothstep' : 'default',
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
  if (!document) return elements
  const rects = hierarchicalLayout({
    tasks: document.tasks,
    rootIds: document.rootTaskIds,
    inputTables: new Map(),
    outputTables: new Map(),
  })
  const nodes = applyRects(elements.nodes, rects)
  return { nodes, edges: assignEdgeAnchors(nodes, elements.edges) }
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

  // Each table card is anchored to one task: the task that writes it when there
  // is one, otherwise the first task that reads it.
  const outputTables = new Map<string, string[]>()
  const inputTables = new Map<string, string[]>()
  const owner = new Map<string, string>()
  const attach = (target: Map<string, string[]>, taskId: string, tableId: string) => {
    if (owner.has(tableId)) return
    owner.set(tableId, taskId)
    target.set(taskId, [...(target.get(taskId) ?? []), tableId])
  }

  taskAnalyses.forEach((item) => {
    item.sql?.targets.forEach((target) => attach(outputTables, item.task.id, tableIdFor(target.qualifiedName)))
  })
  taskAnalyses.forEach((item) => {
    item.sql?.sources.forEach((source) => attach(inputTables, item.task.id, tableIdFor(source.qualifiedName)))
  })

  const templates = templatesByTable(analysis)
  const tableNodes: Node[] = [...tableNames.entries()].map(([key, name]) => ({
    id: `table:${key}`,
    type: 'anchored',
    position: { x: 0, y: 0 },
    data: { label: <TableLabel name={name} analysis={analysis} template={templates.get(key)} /> },
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

  const rects = hierarchicalLayout({
    tasks: document.tasks,
    rootIds: document.rootTaskIds,
    inputTables,
    outputTables,
  })
  const nodes = applyRects([...taskGraph.nodes, ...tableNodes], rects)
  return { nodes, edges: assignEdgeAnchors(nodes, edges) }
}

function lineageElements(analysis: WorkflowAnalysis, selectedDataNodeId: string | undefined, searchQuery: string): { nodes: Node[]; edges: Edge[] } {
  const names = new Set<string>()
  analysis.tableLineage.forEach((record) => {
    names.add(record.source.qualifiedName)
    names.add(record.target.qualifiedName)
  })
  const templates = templatesByTable(analysis)
  const nodes: Node[] = [...names].map((name) => ({
    id: `table:${name}`,
    type: 'anchored',
    position: { x: 0, y: 0 },
    data: { label: <TableLabel name={name} analysis={analysis} template={templates.get(name.toLowerCase())} /> },
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
  const positioned = layoutGraph(nodes, edges, { width: TABLE_WIDTH, height: TABLE_HEIGHT }, 'LR')
  return { nodes: positioned, edges: assignEdgeAnchors(positioned, edges) }
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
        // Remount per view so fitView re-runs: each mode lays the graph out at a
        // very different size and the previous viewport rarely suits the next one.
        key={`${mode}:${document?.path ?? 'none'}`}
        nodes={elements.nodes}
        edges={elements.edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.12, minZoom: mode === 'lineage' ? 0.45 : 0.12, maxZoom: 1.15 }}
        minZoom={0.1}
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
