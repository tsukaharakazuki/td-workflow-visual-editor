import type {
  Diagnostic,
  SqlAnalysis,
  SqlAnalysisOptions,
  SqlColumn,
  SqlTableReference,
} from '../types/workflow'

// A name may interleave literal chunks and `${...}` templates, as in
// `pred_${set[params].name}`. Matching the template first keeps the `$` of an
// opening `${` out of the literal chunk.
const TEMPLATE = '\\$\\{[^{}]*\\}'
const NAME_CHAR = '(?:[A-Za-z0-9_-]|\\$(?!\\{))'
const TEMPLATED_NAME = `(?:${TEMPLATE}|[A-Za-z_]${NAME_CHAR}*)(?:${TEMPLATE}|${NAME_CHAR}+)*`
const IDENTIFIER = `${TEMPLATED_NAME}|"[^"]+"|\`[^\`]+\``
const TABLE_TOKEN = `((?:${IDENTIFIER})(?:\\s*\\.\\s*(?:${IDENTIFIER})){0,2})`
const RESERVED_ALIAS = new Set([
  'as', 'on', 'where', 'group', 'order', 'limit', 'having', 'union', 'join',
  'left', 'right', 'full', 'inner', 'outer', 'cross', 'natural', '与',
])

function maskSql(sql: string): string {
  const chars = sql.split('')
  let quote: "'" | undefined
  let blockComment = false
  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index]
    const next = chars[index + 1]
    if (blockComment) {
      if (current === '*' && next === '/') {
        chars[index] = ' '
        chars[index + 1] = ' '
        index += 1
        blockComment = false
      } else if (current !== '\n') {
        chars[index] = ' '
      }
      continue
    }
    if (quote) {
      if (current === quote && next === quote) {
        chars[index] = ' '
        chars[index + 1] = ' '
        index += 1
      } else if (current === quote) {
        chars[index] = ' '
        quote = undefined
      } else if (current !== '\n') {
        chars[index] = ' '
      }
      continue
    }
    if (current === '/' && next === '*') {
      chars[index] = ' '
      chars[index + 1] = ' '
      index += 1
      blockComment = true
      continue
    }
    if (current === '-' && next === '-') {
      chars[index] = ' '
      chars[index + 1] = ' '
      index += 1
      while (index + 1 < chars.length && chars[index + 1] !== '\n') {
        index += 1
        chars[index] = ' '
      }
      continue
    }
    if (current === "'") {
      chars[index] = ' '
      quote = "'"
    }
  }
  return chars.join('')
}

function unquoteIdentifier(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function normalizeName(value: string): string {
  return splitQualifiedName(value)
    .map((part) => unquoteIdentifier(part))
    .join('.')
}

function splitQualifiedName(value: string): string[] {
  const parts: string[] = []
  let current = ''
  let quote: string | undefined
  let templateDepth = 0
  const text = value.trim()
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (!quote && templateDepth === 0 && char === '$' && text[index + 1] === '{') {
      templateDepth += 1
      current += char
      continue
    }
    if (templateDepth > 0) {
      if (char === '}') templateDepth -= 1
      current += char
      continue
    }
    if ((char === '"' || char === '`') && !quote) {
      quote = char
      current += char
    } else if (char === quote) {
      quote = undefined
      current += char
    } else if (char === '.' && !quote) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

export function parseSqlTableReference(
  rawName: string,
  database?: string,
  location?: number,
): SqlTableReference {
  const normalized = normalizeName(rawName.replace(/[;,]+$/, ''))
  const parts = splitQualifiedName(normalized)
  const dynamic = normalized.includes('${')
  if (dynamic) {
    const table = parts[parts.length - 1] ?? normalized
    const tableDatabase = parts.length >= 2 ? parts.slice(0, -1).join('.') : database
    return {
      name: table,
      ...(tableDatabase ? { database: tableDatabase } : {}),
      qualifiedName: tableDatabase ? `${tableDatabase}.${table}` : table,
      ...(location === undefined ? {} : { location }),
      confidence: 'unresolved',
    }
  }
  if (parts.length >= 2) {
    const table = parts[parts.length - 1]
    const tableDatabase = parts.slice(0, -1).join('.')
    return {
      name: table,
      database: tableDatabase,
      qualifiedName: `${tableDatabase}.${table}`,
      ...(location === undefined ? {} : { location }),
      confidence: 'exact',
    }
  }
  const name = parts[0] ?? normalized
  if (database) {
    return {
      name,
      database,
      qualifiedName: `${database}.${name}`,
      ...(location === undefined ? {} : { location }),
      confidence: 'inferred',
    }
  }
  return {
    name,
    qualifiedName: name,
    ...(location === undefined ? {} : { location }),
    confidence: 'ambiguous',
  }
}

function sourceAlias(masked: string, end: number): string | undefined {
  const tail = masked.slice(end, end + 80)
  const match = tail.match(/^\s+(?:as\s+)?([A-Za-z_][A-Za-z0-9_$-]*)/i)
  const alias = match?.[1]
  if (!alias || RESERVED_ALIAS.has(alias.toLowerCase())) return undefined
  return alias
}

function cteNames(masked: string): string[] {
  const names = new Set<string>()
  const pattern = /(?:\bwith\s+(?:recursive\s+)?|,\s*)([A-Za-z_][A-Za-z0-9_$-]*)\s+as\s*\(/gi
  for (const match of masked.matchAll(pattern)) {
    if (match[1]) names.add(match[1].toLowerCase())
  }
  return [...names]
}

function isCte(reference: SqlTableReference, names: readonly string[]): boolean {
  return names.includes(reference.name.toLowerCase())
}

function tableReferencesFromSources(
  masked: string,
  database: string | undefined,
  ctes: readonly string[],
): SqlTableReference[] {
  const references: SqlTableReference[] = []
  const pattern = new RegExp(`\\b(?:from|join)\\s+${TABLE_TOKEN}`, 'gi')
  for (const match of masked.matchAll(pattern)) {
    const full = match[0]
    const raw = match[1]
    if (!raw || raw.startsWith('(')) continue
    const location = match.index ?? 0
    const reference = parseSqlTableReference(raw, database, location)
    if (isCte(reference, ctes)) continue
    const alias = sourceAlias(masked, location + full.length)
    references.push(alias ? { ...reference, alias } : reference)
  }

  // Also support the conservative, common `FROM a, b` form. We only inspect
  // comma-separated terms until the next clause keyword, never arbitrary SQL.
  const fromPattern = new RegExp(`\\bfrom\\s+([^;]+?)(?=\\b(?:where|group\\s+by|order\\s+by|having|limit|union|qualify)\\b|$)`, 'gi')
  for (const match of masked.matchAll(fromPattern)) {
    const clause = match[1] ?? ''
    if (/\b(?:select|from|join)\b/i.test(clause)) continue
    const terms = splitTopLevel(clause, ',')
    if (terms.length < 2) continue
    for (const term of terms.slice(1)) {
      const candidate = term.trim().match(new RegExp(`^${TABLE_TOKEN}`, 'i'))?.[1]
      if (!candidate || candidate.startsWith('(')) continue
      const reference = parseSqlTableReference(candidate, database, (match.index ?? 0) + (match[0].indexOf(candidate)))
      if (isCte(reference, ctes)) continue
      if (!references.some((existing) => existing.location === reference.location)) references.push(reference)
    }
  }
  const unique = new Map<string, SqlTableReference>()
  for (const reference of references) {
    const key = `${reference.qualifiedName.toLowerCase()}:${reference.alias?.toLowerCase() ?? ''}`
    if (!unique.has(key)) unique.set(key, reference)
  }
  return [...unique.values()]
}

function tableReferencesFromTargets(
  masked: string,
  database: string | undefined,
): SqlTableReference[] {
  const references: SqlTableReference[] = []
  const pattern = new RegExp(
    `\\b(?:create\\s+table(?:\\s+if\\s+not\\s+exists)?|insert\\s+(?:into|overwrite(?:\\s+table)?)|merge\\s+into)\\s+${TABLE_TOKEN}`,
    'gi',
  )
  for (const match of masked.matchAll(pattern)) {
    const raw = match[1]
    if (raw) references.push(parseSqlTableReference(raw, database, match.index ?? 0))
  }
  return references
}

function splitTopLevel(value: string, separator: string): string[] {
  const output: string[] = []
  let start = 0
  let depth = 0
  let quote: string | undefined
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if ((char === "'" || char === '"' || char === '`') && (index === 0 || value[index - 1] !== '\\')) {
      if (!quote) quote = char
      else if (quote === char) quote = undefined
    } else if (!quote && char === '(') depth += 1
    else if (!quote && char === ')') depth = Math.max(0, depth - 1)
    else if (!quote && depth === 0 && value.startsWith(separator, index)) {
      output.push(value.slice(start, index))
      start = index + separator.length
      index += separator.length - 1
    }
  }
  output.push(value.slice(start))
  return output
}

interface KeywordSpan {
  keyword: string
  start: number
  end: number
  depth: number
}

function keywordSpans(masked: string, keyword: string): KeywordSpan[] {
  const spans: KeywordSpan[] = []
  const pattern = new RegExp(`\\b${keyword}\\b`, 'gi')
  for (const match of masked.matchAll(pattern)) {
    const start = match.index ?? 0
    let depth = 0
    for (let index = 0; index < start; index += 1) {
      if (masked[index] === '(') depth += 1
      else if (masked[index] === ')') depth = Math.max(0, depth - 1)
    }
    spans.push({ keyword, start, end: start + keyword.length, depth })
  }
  return spans
}

function outputColumns(sql: string, masked: string): SqlColumn[] {
  const selects = keywordSpans(masked, 'select')
  if (selects.length === 0) return []
  const minimumDepth = Math.min(...selects.map((span) => span.depth))
  const select = [...selects].reverse().find((span) => span.depth === minimumDepth)
  if (!select) return []
  const froms = keywordSpans(masked.slice(select.end), 'from')
    .filter((span) => span.depth === 0)
  const end = froms[0] ? select.end + froms[0].start : sql.length
  const list = sql.slice(select.end, end)
  return splitTopLevel(list, ',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseOutputColumn)
}

function parseOutputColumn(expression: string): SqlColumn {
  const aliasMatch = expression.match(/\s+as\s+([A-Za-z_][A-Za-z0-9_$-]*|"[^"]+"|`[^`]+`)\s*$/i)
  const alias = aliasMatch?.[1] ? unquoteIdentifier(aliasMatch[1]) : undefined
  const withoutAlias = aliasMatch ? expression.slice(0, aliasMatch.index).trim() : expression
  const wildcard = /(?:^|\.)\s*\*\s*$/.test(withoutAlias)
  const simple = withoutAlias.match(/^(?:[A-Za-z_][A-Za-z0-9_$-]*\.)?([A-Za-z_][A-Za-z0-9_$-]*)$/)
  const name = alias ?? (wildcard ? '*' : simple?.[1] ?? withoutAlias)
  return {
    name,
    expression: withoutAlias,
    ...(alias ? { alias } : {}),
    ...(wildcard ? { wildcard: true } : {}),
  }
}

function operatorTarget(
  options: SqlAnalysisOptions,
): SqlTableReference | undefined {
  if (!options.operator || !options.operatorValue) return undefined
  if (options.operator !== 'create_table>' && options.operator !== 'insert_into>') return undefined
  return parseSqlTableReference(options.operatorValue, options.database)
}

export function analyzeSql(
  sql: string,
  options: SqlAnalysisOptions = {},
): SqlAnalysis {
  const masked = maskSql(sql)
  const ctes = cteNames(masked)
  const sources = tableReferencesFromSources(masked, options.database, ctes)
  const targets = tableReferencesFromTargets(masked, options.database)
  const configuredTarget = operatorTarget(options)
  if (configuredTarget && !targets.some((target) => target.qualifiedName === configuredTarget.qualifiedName)) {
    targets.push(configuredTarget)
  }

  const diagnostics: Diagnostic[] = []
  if (sql.trim() && sources.length === 0 && targets.length === 0 && !/\b(select|with)\b/i.test(masked)) {
    diagnostics.push({
      severity: 'info',
      code: 'sql-no-lineage-pattern',
      message: 'SQL did not contain a conservative FROM, JOIN, CREATE TABLE, or INSERT INTO match',
    })
  }
  return {
    sql,
    sources,
    targets,
    outputColumns: outputColumns(sql, masked),
    cteNames: ctes,
    diagnostics,
  }
}

export const analyzeSQL = analyzeSql
