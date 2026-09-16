import { describe, expect, test } from 'vitest'
import { COMMON_TASK_FIELDS, handledTaskKeys, knownOperators, operatorDefinition, operatorFields } from './operator-schema'

describe('operator schema', () => {
  test('covers the operators the palette offers', () => {
    const known = new Set(knownOperators())
    for (const operator of ['td>', 'td_ddl>', 'py>', 'sh>', 'echo>', 'if>', 'for_each>', 'mail>', 'bq>', 'pg>']) {
      expect(known.has(operator), operator).toBe(true)
    }
  })

  test('every field is uniquely keyed and labelled', () => {
    for (const operator of knownOperators()) {
      const fields = operatorFields(operator)
      const keys = fields.map((field) => field.key)
      expect(new Set(keys).size, `${operator} has duplicate keys`).toBe(keys.length)
      for (const field of fields) {
        expect(field.label.length, `${operator}.${field.key} has no label`).toBeGreaterThan(0)
      }
    }
  })

  test('no operator key is repeated as one of its own fields', () => {
    for (const operator of knownOperators()) {
      expect(operatorFields(operator).some((field) => field.key === operator), operator).toBe(false)
    }
  })

  test('every definition links to its documentation', () => {
    for (const operator of knownOperators()) {
      expect(operatorDefinition(operator)?.doc, operator).toMatch(/^https:\/\//)
    }
  })

  test('handled keys cover the operator, its fields and the common task keys', () => {
    const handled = handledTaskKeys('td>')
    expect(handled.has('td>')).toBe(true)
    expect(handled.has('create_table')).toBe(true)
    for (const field of COMMON_TASK_FIELDS) expect(handled.has(field.key), field.key).toBe(true)
    expect(handled.has('not_a_real_key')).toBe(false)
  })

  test('an unknown operator has no definition and no fields', () => {
    expect(operatorDefinition('made_up>')).toBeUndefined()
    expect(operatorFields('made_up>')).toHaveLength(0)
  })
})
