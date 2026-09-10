import type { VariableScope } from '../types/workflow'

/**
 * Digdag interpolates `${...}` with a JavaScript engine at run time. We cannot
 * run that here, so this module evaluates the small, side-effect-free subset
 * that table names actually use: variable lookups, property and index access,
 * literals, and `Object.keys` / `Object.values`. Anything else stays unresolved
 * and the original expression is kept for display.
 */

export interface TemplateExpansion {
  /** The name with every expression we could resolve substituted. */
  text: string
  /** False when at least one expression was left as-is. */
  resolved: boolean
}

const OBJECT_BUILTIN = Symbol('Object')
const OBJECT_KEYS_BUILTIN = Symbol('Object.keys')
const OBJECT_VALUES_BUILTIN = Symbol('Object.values')

interface Token {
  kind: 'name' | 'number' | 'string' | 'punct'
  value: string
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (/\s/.test(char)) {
      index += 1
      continue
    }
    if (char === "'" || char === '"') {
      let value = ''
      index += 1
      while (index < source.length && source[index] !== char) {
        value += source[index]
        index += 1
      }
      if (index >= source.length) throw new Error('unterminated string literal')
      index += 1
      tokens.push({ kind: 'string', value })
      continue
    }
    if (/[0-9]/.test(char)) {
      let value = ''
      while (index < source.length && /[0-9.]/.test(source[index])) {
        value += source[index]
        index += 1
      }
      tokens.push({ kind: 'number', value })
      continue
    }
    if (/[A-Za-z_$]/.test(char)) {
      let value = ''
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) {
        value += source[index]
        index += 1
      }
      tokens.push({ kind: 'name', value })
      continue
    }
    if ('.[]()'.includes(char)) {
      tokens.push({ kind: 'punct', value: char })
      index += 1
      continue
    }
    throw new Error(`unsupported character ${char}`)
  }
  return tokens
}

class TokenReader {
  private position = 0
  private readonly tokens: readonly Token[]

  constructor(tokens: readonly Token[]) {
    this.tokens = tokens
  }

  peek(): Token | undefined {
    return this.tokens[this.position]
  }

  next(): Token {
    const token = this.tokens[this.position]
    if (!token) throw new Error('unexpected end of expression')
    this.position += 1
    return token
  }

  expect(value: string): void {
    const token = this.next()
    if (token.value !== value) throw new Error(`expected ${value}`)
  }

  atEnd(): boolean {
    return this.position >= this.tokens.length
  }
}

function member(base: unknown, key: string): unknown {
  if (base === OBJECT_BUILTIN) {
    if (key === 'keys') return OBJECT_KEYS_BUILTIN
    if (key === 'values') return OBJECT_VALUES_BUILTIN
    throw new Error(`unsupported Object.${key}`)
  }
  if (base === null || base === undefined) throw new Error('cannot read a property of nothing')
  if (Array.isArray(base)) {
    const index = Number(key)
    if (!Number.isInteger(index)) throw new Error('array index must be an integer')
    return base[index]
  }
  if (typeof base !== 'object') throw new Error('cannot read a property of a scalar')
  const record = base as Record<string, unknown>
  if (!(key in record)) throw new Error(`unknown property ${key}`)
  return record[key]
}

function call(target: unknown, argument: unknown): unknown {
  if (target === OBJECT_KEYS_BUILTIN || target === OBJECT_VALUES_BUILTIN) {
    if (!argument || typeof argument !== 'object' || Array.isArray(argument)) {
      throw new Error('Object.keys/values needs an object')
    }
    const record = argument as Record<string, unknown>
    return target === OBJECT_KEYS_BUILTIN ? Object.keys(record) : Object.values(record)
  }
  throw new Error('unsupported function call')
}

function readExpression(reader: TokenReader, scope: VariableScope): unknown {
  let value = readPrimary(reader, scope)
  for (;;) {
    const token = reader.peek()
    if (!token || token.kind !== 'punct') break
    if (token.value === '.') {
      reader.next()
      const name = reader.next()
      if (name.kind !== 'name') throw new Error('expected a property name')
      value = member(value, name.value)
      continue
    }
    if (token.value === '[') {
      reader.next()
      const key = readExpression(reader, scope)
      reader.expect(']')
      value = member(value, String(key))
      continue
    }
    if (token.value === '(') {
      reader.next()
      const argument = reader.peek()?.value === ')' ? undefined : readExpression(reader, scope)
      reader.expect(')')
      value = call(value, argument)
      continue
    }
    break
  }
  return value
}

function readPrimary(reader: TokenReader, scope: VariableScope): unknown {
  const token = reader.next()
  if (token.kind === 'string') return token.value
  if (token.kind === 'number') return Number(token.value)
  if (token.kind === 'name') {
    if (token.value === 'Object') return OBJECT_BUILTIN
    if (!(token.value in scope)) throw new Error(`unknown variable ${token.value}`)
    return scope[token.value]
  }
  if (token.value === '(') {
    const value = readExpression(reader, scope)
    reader.expect(')')
    return value
  }
  throw new Error('unexpected token')
}

/** Returns undefined when the expression falls outside the supported subset. */
export function evaluateExpression(expression: string, scope: VariableScope): unknown {
  try {
    const reader = new TokenReader(tokenize(expression))
    const value = readExpression(reader, scope)
    return reader.atEnd() ? value : undefined
  } catch {
    return undefined
  }
}

const TEMPLATE_PATTERN = /\$\{([^{}]*)\}/g

export function containsTemplate(text: string): boolean {
  return text.includes('${')
}

export function expandTemplate(text: string, scope: VariableScope): TemplateExpansion {
  if (!containsTemplate(text)) return { text, resolved: true }
  let resolved = true
  const expanded = text.replace(TEMPLATE_PATTERN, (raw, expression: string) => {
    const value = evaluateExpression(expression, scope)
    if (value === undefined || value === null || typeof value === 'object') {
      resolved = false
      return raw
    }
    return String(value)
  })
  return { text: expanded, resolved }
}

/** Expands against every scope a task runs under, keeping each distinct result. */
export function expandTemplateAcross(
  text: string,
  scopes: readonly VariableScope[],
): TemplateExpansion[] {
  if (!containsTemplate(text)) return [{ text, resolved: true }]
  const found = new Map<string, TemplateExpansion>()
  for (const scope of scopes.length > 0 ? scopes : [{}]) {
    const expansion = expandTemplate(text, scope)
    if (!found.has(expansion.text)) found.set(expansion.text, expansion)
  }
  return [...found.values()]
}
