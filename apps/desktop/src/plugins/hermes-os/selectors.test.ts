import { describe, expect, it } from 'vitest'

import { activeRunCount, activeRunIds } from './selectors'

describe('Hermes OS selectors', () => {
  it('derives active runs only from authoritative busy session flags', () => {
    const state = {
      idle: false,
      runningA: true,
      runningB: true
    }

    expect(activeRunIds(state)).toEqual(['runningA', 'runningB'])
    expect(activeRunCount(state)).toBe(2)
  })

  it('returns an empty operational set when no Hermes session is mid-turn', () => {
    expect(activeRunIds({ a: false, b: false })).toEqual([])
    expect(activeRunCount({ a: false, b: false })).toBe(0)
  })
})
