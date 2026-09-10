import type { Document } from 'yaml'

export type YamlPathSegment = string | number
export type YamlPath = readonly YamlPathSegment[]

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  severity: DiagnosticSeverity
  message: string
  code?: string
  path?: YamlPath
  filePath?: string
  line?: number
  column?: number
}

export type WorkflowFileKind = 'dig' | 'sql' | 'schema' | 'config' | 'binary'
export type WorkflowFileEncoding = 'utf8' | 'binary'

export interface WorkflowFile {
  path: string
  kind: WorkflowFileKind
  encoding: WorkflowFileEncoding
  bytes: Uint8Array
  /** Decoded text for UTF-8 files. Binary files intentionally have no text. */
  text?: string
  decodeError?: string
}

export interface ZipLimits {
  maxInputBytes: number
  maxExpandedBytes: number
  maxFiles: number
  maxFileBytes: number
}

export const DEFAULT_ZIP_LIMITS: Readonly<ZipLimits> = Object.freeze({
  maxInputBytes: 100 * 1024 * 1024,
  maxExpandedBytes: 200 * 1024 * 1024,
  maxFiles: 2000,
  maxFileBytes: 20 * 1024 * 1024,
})

export interface WorkflowArchive {
  files: WorkflowFile[]
  inputBytes: number
  expandedBytes: number
  diagnostics: Diagnostic[]
}

export type ZipInput = Uint8Array | ArrayBuffer | Blob

export type TaskOperator =
  | '_parallel'
  | 'if>'
  | 'for_each>'
  | 'call>'
  | 'require>'
  | 'td>'
  | 'create_table>'
  | 'insert_into>'
  | string

export interface SqlReference {
  kind: 'inline' | 'reference'
  text?: string
  path?: string
  yamlPath?: YamlPath
}

export interface DigdagTaskNode {
  id: string
  name: string
  documentPath: string
  yamlPath: YamlPath
  parentId?: string
  children: string[]
  depth: number
  order: number
  operator?: TaskOperator
  operators: TaskOperator[]
  database?: string
  engine?: string
  sql?: SqlReference
  /** A JSON-safe snapshot of the task value at parse time. */
  value: unknown
}

export interface DigdagDocument {
  path: string
  text: string
  document: Document.Parsed
  tasks: DigdagTaskNode[]
  rootTaskIds: string[]
  diagnostics: Diagnostic[]
}

export interface DigdagParseOptions {
  path?: string
}

export type SqlConfidence = 'exact' | 'inferred' | 'ambiguous' | 'unresolved'

export interface SqlTableReference {
  name: string
  database?: string
  alias?: string
  qualifiedName: string
  confidence: SqlConfidence
  location?: number
}

export interface SqlColumn {
  name: string
  expression: string
  alias?: string
  wildcard?: boolean
}

export interface SqlAnalysis {
  sql: string
  sources: SqlTableReference[]
  targets: SqlTableReference[]
  outputColumns: SqlColumn[]
  cteNames: string[]
  diagnostics: Diagnostic[]
}

export interface SchemaColumn {
  name: string
  type?: string
  nullable?: boolean
  description?: string
}

export interface SchemaTable {
  name: string
  database?: string
  qualifiedName: string
  columns: SchemaColumn[]
}

export interface WorkflowSchema {
  format: 'td-workflow-lineage-schema'
  version: 1
  tables: SchemaTable[]
  diagnostics: Diagnostic[]
  sourcePath?: string
}

export interface SchemaParseResult {
  schema?: WorkflowSchema
  diagnostics: Diagnostic[]
}

export interface SqlAnalysisOptions {
  database?: string
  operator?: string
  operatorValue?: string
}

export interface TableLineageRecord {
  source: SqlTableReference
  target: SqlTableReference
  taskId?: string
  confidence: SqlConfidence
}

export interface ColumnLineageRecord {
  sourceTable?: string
  sourceColumn?: string
  targetTable?: string
  targetColumn: string
  taskId?: string
  confidence: SqlConfidence
  wildcard?: boolean
}

export interface PipelineEdge {
  from: string
  to: string
  kind: 'sequence' | 'table' | 'require'
  confidence: SqlConfidence
  table?: string
}

export interface WorkflowTaskAnalysis {
  task: DigdagTaskNode
  sql?: SqlAnalysis
  sourceFilePath?: string
}

export interface WorkflowAnalysis {
  documents: DigdagDocument[]
  schemas: WorkflowSchema[]
  tasks: WorkflowTaskAnalysis[]
  tableLineage: TableLineageRecord[]
  columnLineage: ColumnLineageRecord[]
  edges: PipelineEdge[]
  diagnostics: Diagnostic[]
}

export interface WorkflowAnalysisOptions {
  schemaFiles?: Record<string, string | Uint8Array>
  includeBinaryFiles?: boolean
}

export interface DigdagParallelSettings {
  enabled: boolean
  limit?: number
  eager?: boolean
}

export interface TaskEditSnapshot {
  path: string
  text: string
}

export interface DigdagEditResult {
  document: DigdagDocument
  before: TaskEditSnapshot
  after: TaskEditSnapshot
  inverse: DigdagEdit
}

export type DigdagEdit =
  | {
      kind: 'add-sibling'
      siblingId: string
      name: string
      value?: unknown
    }
  | {
      kind: 'delete-task'
      taskId: string
    }
  | {
      kind: 'reorder-siblings'
      taskIds: string[]
    }
  | {
      kind: 'restore-task'
      parentId?: string
      name: string
      value?: unknown
      index: number
    }
  | {
      kind: 'restore-reorder'
      taskIds: string[]
    }
  | {
      kind: 'noop'
    }

export class WorkflowArchiveError extends Error {
  readonly code: string
  readonly path?: string

  constructor(code: string, message: string, path?: string) {
    super(message)
    this.name = 'WorkflowArchiveError'
    this.code = code
    this.path = path
  }
}

export class DigdagEditError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DigdagEditError'
    this.code = code
  }
}
