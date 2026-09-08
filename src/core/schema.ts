import { parseDocument as parseYamlDocument } from 'yaml'
import type {
  Diagnostic,
  SchemaColumn,
  SchemaParseResult,
  SchemaTable,
  SqlTableReference,
  WorkflowSchema,
} from '../types/workflow'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function splitName(rawName: string, database?: string): { name: string; database?: string; qualifiedName: string } {
  const parts = rawName.split('.').map((part) => part.trim()).filter(Boolean)
  if (parts.length > 1) {
    const table = parts.pop() as string
    const db = database ?? parts.join('.')
    return { name: table, database: db, qualifiedName: `${db}.${table}` }
  }
  return {
    name: rawName,
    ...(database ? { database } : {}),
    qualifiedName: database ? `${database}.${rawName}` : rawName,
  }
}

function normalizeColumns(value: unknown, tableName: string, diagnostics: Diagnostic[]): SchemaColumn[] {
  if (Array.isArray(value)) {
    return value.flatMap((column, index) => {
      if (typeof column === 'string') return [{ name: column }]
      const record = asRecord(column)
      const name = record ? textValue(record.name ?? record.column) : undefined
      if (!record || !name) {
        diagnostics.push({
          severity: 'warning',
          code: 'schema-column-invalid',
          message: `Ignored schema column ${index} in ${tableName}`,
        })
        return []
      }
      const type = textValue(record.type)
      const description = textValue(record.description)
      return [{
        name,
        ...(type ? { type } : {}),
        ...(typeof record.nullable === 'boolean' ? { nullable: record.nullable } : {}),
        ...(description ? { description } : {}),
      }]
    })
  }
  const record = asRecord(value)
  if (!record) return []
  return Object.entries(record).map(([name, definition]) => {
    if (typeof definition === 'string') return { name, type: definition }
    const column = asRecord(definition)
    return {
      name,
      ...(column && textValue(column.type) ? { type: textValue(column.type) } : {}),
      ...(column && typeof column.nullable === 'boolean' ? { nullable: column.nullable } : {}),
      ...(column && textValue(column.description) ? { description: textValue(column.description) } : {}),
    }
  })
}

function normalizeTable(
  key: string | undefined,
  value: unknown,
  diagnostics: Diagnostic[],
): SchemaTable | undefined {
  const record = asRecord(value)
  const rawName = textValue(record?.name ?? record?.table ?? key)
  if (!rawName) {
    diagnostics.push({ severity: 'warning', code: 'schema-table-invalid', message: 'Ignored schema table without a name' })
    return undefined
  }
  const database = textValue(record?.database)
  const identity = splitName(rawName, database)
  const columnsValue = record?.columns ?? record?.schema ?? value
  return {
    ...identity,
    columns: normalizeColumns(columnsValue, identity.qualifiedName, diagnostics),
  }
}

export function normalizeWorkflowSchema(
  input: unknown,
  sourcePath?: string,
): SchemaParseResult {
  const diagnostics: Diagnostic[] = []
  const root = asRecord(input)
  if (!root || root.format !== 'td-workflow-lineage-schema' || root.version !== 1) {
    diagnostics.push({
      severity: 'error',
      code: 'schema-format-invalid',
      message: 'Schema sidecar must use format td-workflow-lineage-schema and version 1',
      ...(sourcePath ? { filePath: sourcePath } : {}),
    })
    return { diagnostics }
  }

  const tables: SchemaTable[] = []
  const databasesValue = root.databases
  if (Array.isArray(databasesValue)) {
    for (const databaseValue of databasesValue) {
      const database = asRecord(databaseValue)
      const databaseName = textValue(database?.name ?? database?.database)
      const databaseTables = database?.tables
      if (!databaseName || !Array.isArray(databaseTables)) {
        diagnostics.push({
          severity: 'warning',
          code: 'schema-database-invalid',
          message: 'Ignored schema database without a name or tables array',
        })
        continue
      }
      for (const tableValue of databaseTables) {
        const tableRecord = asRecord(tableValue)
        const table = normalizeTable(undefined, {
          ...tableRecord,
          database: textValue(tableRecord?.database) ?? databaseName,
        }, diagnostics)
        if (table) tables.push(table)
      }
    }
  } else {
    const tablesValue = root.tables
    if (Array.isArray(tablesValue)) {
      for (const value of tablesValue) {
        const table = normalizeTable(undefined, value, diagnostics)
        if (table) tables.push(table)
      }
    } else {
      const tableMap = asRecord(tablesValue)
      if (!tableMap) {
        diagnostics.push({
          severity: 'error',
          code: 'schema-tables-invalid',
          message: 'Schema sidecar must contain databases[].tables or a top-level tables array/mapping',
        })
      } else {
        for (const [key, value] of Object.entries(tableMap)) {
          const table = normalizeTable(key, value, diagnostics)
          if (table) tables.push(table)
        }
      }
    }
  }

  const seen = new Set<string>()
  for (const table of tables) {
    const key = table.qualifiedName.toLowerCase()
    if (seen.has(key)) {
      diagnostics.push({ severity: 'warning', code: 'schema-duplicate-table', message: `Duplicate schema table ${table.qualifiedName}` })
    }
    seen.add(key)
  }
  return {
    schema: {
      format: 'td-workflow-lineage-schema',
      version: 1,
      tables,
      diagnostics,
      ...(sourcePath ? { sourcePath } : {}),
    },
    diagnostics,
  }
}

export function parseWorkflowSchema(
  input: string | Uint8Array,
  sourcePath?: string,
): SchemaParseResult {
  let text: string
  try {
    text = typeof input === 'string'
      ? input
      : new TextDecoder('utf-8', { fatal: true }).decode(input)
  } catch {
    const diagnostic: Diagnostic = {
      severity: 'error',
      code: 'schema-invalid-utf8',
      message: 'Schema sidecar is not valid UTF-8',
      ...(sourcePath ? { filePath: sourcePath } : {}),
    }
    return { diagnostics: [diagnostic] }
  }

  try {
    const document = parseYamlDocument(text)
    const diagnostics: Diagnostic[] = document.errors.map((error) => ({
      severity: 'error',
      code: 'schema-yaml-error',
      message: error.message,
      ...(sourcePath ? { filePath: sourcePath } : {}),
    }))
    if (diagnostics.length > 0) return { diagnostics }
    const result = normalizeWorkflowSchema(document.toJS(), sourcePath)
    return {
      schema: result.schema,
      diagnostics: [...diagnostics, ...result.diagnostics],
    }
  } catch (error) {
    return {
      diagnostics: [{
        severity: 'error',
        code: 'schema-parse-error',
        message: error instanceof Error ? error.message : 'Unable to parse schema sidecar',
        ...(sourcePath ? { filePath: sourcePath } : {}),
      }],
    }
  }
}

export function findSchemaTable(
  reference: Pick<SqlTableReference, 'qualifiedName' | 'name' | 'database'>,
  schemas: readonly WorkflowSchema[],
): { table?: SchemaTable; confidence: 'exact' | 'inferred' | 'ambiguous' | 'unresolved' } {
  const qualified = reference.qualifiedName.toLowerCase()
  const exact = schemas.flatMap((schema) => schema.tables)
    .filter((table) => table.qualifiedName.toLowerCase() === qualified)
  if (exact.length === 1) return { table: exact[0], confidence: 'exact' }
  if (exact.length > 1) return { confidence: 'ambiguous' }

  const sameName = schemas.flatMap((schema) => schema.tables)
    .filter((table) => table.name.toLowerCase() === reference.name.toLowerCase())
  if (sameName.length === 1) return { table: sameName[0], confidence: 'inferred' }
  if (sameName.length > 1) return { confidence: 'ambiguous' }
  return { confidence: 'unresolved' }
}

export function schemaColumnsForReference(
  reference: SqlTableReference,
  schemas: readonly WorkflowSchema[],
): { columns: SchemaColumn[]; confidence: 'exact' | 'inferred' | 'ambiguous' | 'unresolved' } {
  const found = findSchemaTable(reference, schemas)
  return { columns: found.table?.columns ?? [], confidence: found.confidence }
}

export function parseSchemaSidecar(input: string | Uint8Array, sourcePath?: string): WorkflowSchema | undefined {
  return parseWorkflowSchema(input, sourcePath).schema
}
