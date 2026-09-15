import { Fragment, useEffect, useMemo, useState, type ReactNode, type RefObject } from 'react'
import dagre from '@dagrejs/dagre'
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import { ArrowDownToLine, Braces, ChevronDown, Database, EllipsisVertical, GitBranch, GitFork, Layers3, Network, Repeat2, Search, Table2 } from 'lucide-react'
import { inferredTableFor, parallelSettingsForTask } from '../core'
import { passesGraphFilters, UNSPECIFIED } from './GraphFilterBar'
import type { GraphFilterGroup, GraphFilterSelection } from './GraphFilterBar'
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
  filterGroups?: readonly GraphFilterGroup[]
  filterSelection?: GraphFilterSelection
}

const NODE_WIDTH = 260
const NODE_HEIGHT = 112
const TABLE_WIDTH = 310
const TABLE_HEIGHT = 274
/** Horizontal step per nesting level in the outline. */
const INDENT_WIDTH = 58
/** Vertical gap between rows of the outline. */
const ROW_GAP = 34
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

/**
 * An outline is read top to bottom, so it opens fitted to the width with the
 * first task in view rather than shrunk until the whole column fits.
 */
function FitToWidth({ nodes, signature }: { nodes: readonly Node[]; signature: string }) {
  const flow = useReactFlow()
  useEffect(() => {
    if (nodes.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      let left = Infinity
      let right = -Infinity
      let top = Infinity
      for (const node of nodes) {
        const width = Number(node.style?.width ?? NODE_WIDTH)
        left = Math.min(left, node.position.x)
        right = Math.max(right, node.position.x + width)
        top = Math.min(top, node.position.y)
      }
      const graphWidth = right - left
      if (!Number.isFinite(graphWidth) || graphWidth <= 0) return
      const viewport = document.querySelector('.graph-canvas')?.getBoundingClientRect()
      if (!viewport || viewport.width === 0) return
      // Never magnify past natural size: a narrow outline should not fill the canvas.
      const zoom = Math.min(1, Math.max(0.12, (viewport.width - CANVAS_MARGIN * 2) / graphWidth))
      flow.setViewport({
        x: (viewport.width - graphWidth * zoom) / 2 - left * zoom,
        y: CANVAS_MARGIN - top * zoom,
        zoom,
      })
    })
    return () => window.cancelAnimationFrame(frame)
    // Refit when the graph itself changes, not on every node identity churn.
  }, [flow, signature])
  return null
}

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

function taskLabel(task: DigdagTaskNode, childMode?: 'parallel' | 'sequential') {
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
        {childMode && (
          <span className={`graph-task-mode ${childMode}`} title={childMode === 'parallel' ? '子タスクは並列実行' : '子タスクは順次実行'}>
            {childMode === 'parallel' ? <><GitFork size={10} /> 並列</> : <><ArrowDownToLine size={10} /> 順次</>}
          </span>
        )}
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
  // With no schema sidecar, fall back to what the SQL itself reveals.
  const inferred = schema ? undefined : inferredTableFor(name, analysis.inferredTables)
  const [columnQuery, setColumnQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const parts = name.split('.')
  const tableName = schema?.name ?? inferred?.name ?? parts.at(-1) ?? name
  const serviceName = schema?.database ?? inferred?.database ?? (parts.slice(0, -1).join('.') || 'Workflow')
  const allColumns: Array<{ name: string; type?: string }> = schema?.columns
    ?? inferred?.columns.map((column) => ({
      name: column.name,
      type: column.origin === 'output' ? 'SELECT' : '参照',
    }))
    ?? []
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
          {inferred && allColumns.length > 0 && <em className="graph-column-inferred" title="スキーマ情報が無いため、SQLから推定したカラムです">推定</em>}
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

/** Filters dim what they exclude rather than removing it, so the shape of the graph stays readable. */
interface GraphFilterContext {
  groups: readonly GraphFilterGroup[]
  selection: GraphFilterSelection
}

function taskFilterValues(task: DigdagTaskNode): Record<string, string> {
  return {
    kind: 'タスク',
    operator: operatorLabel(task),
    engine: task.engine?.trim() || UNSPECIFIED,
    database: task.database?.trim() || UNSPECIFIED,
  }
}

function tableFilterValues(name: string): Record<string, string> {
  const parts = name.split('.')
  return {
    kind: 'テーブル',
    database: parts.length > 1 ? parts.slice(0, -1).join('.') : UNSPECIFIED,
  }
}

function nodeClass(
  searchValue: string,
  searchQuery: string,
  filters: GraphFilterContext | undefined,
  kind: 'task' | 'table',
  values: Record<string, string>,
): string {
  if (filters && !passesGraphFilters(filters.groups, filters.selection, kind, values)) return ' is-filtered-out'
  return searchClass(searchValue, searchQuery)
}

function tableSearchValue(name: string, analysis: WorkflowAnalysis): string {
  const schema = schemaTableFor(name, analysis)
  if (schema) return [name, ...schema.columns.map((column) => `${column.name} ${column.type ?? ''}`)].join(' ')
  const inferred = inferredTableFor(name, analysis.inferredTables)
  return [name, ...(inferred?.columns.map((column) => column.name) ?? [])].join(' ')
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

interface OutlineInput {
  tasks: readonly DigdagTaskNode[]
  rootIds: readonly string[]
  inputTables: Map<string, string[]>
  outputTables: Map<string, string[]>
}

function stackHeight(count: number): number {
  return count === 0 ? 0 : count * TABLE_HEIGHT + (count - 1) * TABLE_STACK_GAP
}

/**
 * Lays the task tree out as an indented outline: one task per row, top to
 * bottom in execution order, each level of nesting stepped to the right. A wide
 * tree stays narrow this way, and depth reads at a glance from the indent.
 * Tables attached to a task sit on its own row — inputs left, outputs right.
 */
function outlineLayout({ tasks, rootIds, inputTables, outputTables }: OutlineInput): Map<string, GraphRect> {
  const rects = new Map<string, GraphRect>()
  const byId = new Map(tasks.map((task) => [task.id, task]))
  if (byId.size === 0) return rects

  const childIdsOf = (id: string): string[] => (byId.get(id)?.children ?? [])
    .filter((childId) => byId.has(childId))
    .sort((left, right) => (byId.get(left)?.order ?? 0) - (byId.get(right)?.order ?? 0))

  const roots = rootIds.filter((id) => byId.has(id))
  const effectiveRoots = roots.length > 0
    ? roots
    : tasks.filter((task) => !task.parentId || !byId.has(task.parentId)).map((task) => task.id)

  const rows: Array<{ id: string; depth: number }> = []
  const visit = (id: string, depth: number) => {
    rows.push({ id, depth })
    childIdsOf(id).forEach((childId) => visit(childId, depth + 1))
  }
  effectiveRoots.forEach((id) => visit(id, 0))

  // One shared left margin, so every input table column lines up.
  const leftMargin = rows.some(({ id }) => (inputTables.get(id)?.length ?? 0) > 0)
    ? TABLE_WIDTH + TABLE_GAP
    : 0

  let top = CANVAS_MARGIN
  for (const { id, depth } of rows) {
    const inputs = inputTables.get(id) ?? []
    const outputs = outputTables.get(id) ?? []
    const rowHeight = Math.max(NODE_HEIGHT, stackHeight(inputs.length), stackHeight(outputs.length))
    const center = top + rowHeight / 2
    const taskX = CANVAS_MARGIN + leftMargin + depth * INDENT_WIDTH

    rects.set(id, { x: taskX, y: center - NODE_HEIGHT / 2, width: NODE_WIDTH, height: NODE_HEIGHT })

    const placeStack = (tableIds: readonly string[], x: number) => {
      let y = center - stackHeight(tableIds.length) / 2
      tableIds.forEach((tableId) => {
        rects.set(tableId, { x, y, width: TABLE_WIDTH, height: TABLE_HEIGHT })
        y += TABLE_HEIGHT + TABLE_STACK_GAP
      })
    }
    if (inputs.length > 0) placeStack(inputs, taskX - TABLE_WIDTH - TABLE_GAP)
    if (outputs.length > 0) placeStack(outputs, taskX + NODE_WIDTH + TABLE_GAP)

    top += rowHeight + ROW_GAP
  }

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
    if (edge.sourceHandle && edge.targetHandle) return edge
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
  filters: GraphFilterContext | undefined,
): { nodes: Node[]; edges: Edge[] } {
  if (!document) return { nodes: [], edges: [] }
  const ids = new Set(document.tasks.map((task) => task.id))
  const childMode = (task: DigdagTaskNode): 'parallel' | 'sequential' | undefined => {
    if (task.children.length === 0) return undefined
    return parallelSettingsForTask(task).enabled ? 'parallel' : 'sequential'
  }
  const byId = new Map(document.tasks.map((task) => [task.id, task]))
  const nodes: Node[] = document.tasks.map((task) => ({
    id: task.id,
    type: 'anchored',
    position: { x: 0, y: 0 },
    data: { label: taskLabel(task, childMode(task)) },
    className: `workflow-node tone-${operatorTone(task.operator)}${selectedTaskId === task.id ? ' is-selected' : ''}${nodeClass(`${task.name} ${operatorLabel(task)} ${task.documentPath} ${task.database ?? ''}`, searchQuery, filters, 'task', taskFilterValues(task))}`,
    style: { width: NODE_WIDTH, minHeight: NODE_HEIGHT },
  }))
  const edgeKeys = new Set<string>()
  const edges: Edge[] = []
  const addEdge = (source: string, target: string, kind: string, label?: string) => {
    if (!ids.has(source) || !ids.has(target)) return
    const key = `${source}:${target}:${kind}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    // The outline gives each relationship its own gutter: containment runs down
    // the left of the children it owns, execution order down the right.
    const anchors = kind.startsWith('contains')
      ? { sourceHandle: `${Position.Left}-source`, targetHandle: `${Position.Left}-target` }
      : kind === 'sequence'
        ? { sourceHandle: `${Position.Right}-source`, targetHandle: `${Position.Right}-target` }
        : undefined
    edges.push({
      id: key,
      source,
      target,
      type: kind === 'sequence' || kind.startsWith('contains') ? 'smoothstep' : 'default',
      label,
      className: `workflow-edge edge-${kind}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      ...(anchors ?? {}),
    })
  }
  // A task-only view intentionally omits table edges. The combined view adds
  // explicit table nodes and task/table edges below instead of hiding data flow
  // inside a task-to-task edge.
  analysis.edges.forEach((edge) => {
    if (edge.kind !== 'table') addEdge(edge.from, edge.to, edge.kind)
  })
  document.tasks.forEach((task) => {
    if (!task.parentId) return
    const parent = byId.get(task.parentId)
    addEdge(task.parentId, task.id, parent && childMode(parent) === 'parallel' ? 'contains-parallel' : 'contains')
  })
  return { nodes, edges }
}

function pipelineElements(
  analysis: WorkflowAnalysis,
  document: DigdagDocument | undefined,
  selectedTaskId: string | undefined,
  searchQuery: string,
  filters: GraphFilterContext | undefined,
): { nodes: Node[]; edges: Edge[] } {
  const elements = taskElements(analysis, document, selectedTaskId, searchQuery, filters)
  if (!document) return elements
  const rects = outlineLayout({
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
  filters: GraphFilterContext | undefined,
): { nodes: Node[]; edges: Edge[] } {
  const taskGraph = taskElements(analysis, document, selectedTaskId, searchQuery, filters)
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
    className: `lineage-table-node workflow-data-node${selectedDataNodeId === `table:${key}` ? ' is-selected' : ''}${nodeClass(tableSearchValue(name, analysis), searchQuery, filters, 'table', tableFilterValues(name))}`,
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

  const rects = outlineLayout({
    tasks: document.tasks,
    rootIds: document.rootTaskIds,
    inputTables,
    outputTables,
  })
  const nodes = applyRects([...taskGraph.nodes, ...tableNodes], rects)
  return { nodes, edges: assignEdgeAnchors(nodes, edges) }
}

function lineageElements(
  analysis: WorkflowAnalysis,
  selectedDataNodeId: string | undefined,
  searchQuery: string,
  filters: GraphFilterContext | undefined,
): { nodes: Node[]; edges: Edge[] } {
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
    className: `lineage-table-node${selectedDataNodeId === `table:${name}` ? ' is-selected' : ''}${nodeClass(tableSearchValue(name, analysis), searchQuery, filters, 'table', tableFilterValues(name))}`,
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
  filterGroups,
  filterSelection,
}: WorkflowGraphProps) {
  const [selectedDataNodeId, setSelectedDataNodeId] = useState<string>()
  const filters = useMemo<GraphFilterContext | undefined>(
    () => filterGroups && filterSelection ? { groups: filterGroups, selection: filterSelection } : undefined,
    [filterGroups, filterSelection],
  )
  const elements = useMemo(
    () => mode === 'pipeline'
      ? pipelineElements(analysis, document, selectedTaskId, searchQuery, filters)
      : mode === 'combined'
        ? combinedElements(analysis, document, selectedTaskId, selectedDataNodeId, searchQuery, filters)
        : lineageElements(analysis, selectedDataNodeId, searchQuery, filters),
    [analysis, document, filters, mode, searchQuery, selectedDataNodeId, selectedTaskId],
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
        fitView={mode === 'lineage'}
        // Every mode may zoom out as far as it needs: clamping the fit leaves
        // part of the graph off-screen, which is worse than small cards.
        fitViewOptions={{ padding: 0.12, minZoom: 0.1, maxZoom: 1.15 }}
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
        {mode !== 'lineage' && (
          <FitToWidth nodes={elements.nodes} signature={`${mode}:${document?.path ?? ''}:${elements.nodes.length}`} />
        )}
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
