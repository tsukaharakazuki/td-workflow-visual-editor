import { describe, expect, test } from 'vitest'
import { RELEASE_LOG } from './releaseLog'

describe('release log', () => {
  test('every entry has a yyyy-MM-dd HH:mm:ss timestamp and a summary', () => {
    for (const entry of RELEASE_LOG) {
      expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      expect(entry.summary.trim().length).toBeGreaterThan(0)
    }
  })

  test('entries run newest first', () => {
    const timestamps = RELEASE_LOG.map((entry) => entry.at)
    expect(timestamps).toEqual([...timestamps].sort().reverse())
  })

  test('no two entries share a timestamp', () => {
    expect(new Set(RELEASE_LOG.map((entry) => entry.at)).size).toBe(RELEASE_LOG.length)
  })
})
