import { expect, it } from 'vitest'

import { memoryCardForNode, searchMemoryGraph } from './memory-search'
import type { AgentOSLearningGraph } from './types'

it('matches current content identities and rejects replaced, wrong-source or missing cards at the same index', () => {
  const card = { source: 'memory', title: 'Preference', body: 'Use clear words', fingerprint: '123456abcdef' }
  const node = { id: `memory:memory:0:${card.fingerprint}`, label: card.title, kind: 'memory' }

  expect(memoryCardForNode(node, [card])).toBe(card)
  expect(memoryCardForNode(node, [{ ...card, fingerprint: 'abcdef123456' }])).toBeUndefined()
  expect(memoryCardForNode(node, [{ ...card, source: 'user' }])).toBeUndefined()
  expect(memoryCardForNode(node, [])).toBeUndefined()
  const { fingerprint: _, ...legacy } = card

  expect(memoryCardForNode({ ...node, id: 'memory:memory:0' }, [legacy])).toBe(legacy)
  expect(memoryCardForNode({ ...node, id: 'memory:memory:0' }, [card])).toBeUndefined()
})

it('keeps original card indices and only edges whose endpoints match the search', () => {
  const memory = ['ordinary', 'needle'].map((body, index) => ({ source: 'memory', title: body, body, fingerprint: String(index).repeat(12) }))
  const nodes = memory.map((card, index) => ({ id: `memory:memory:${index}:${card.fingerprint}`, label: card.title, kind: 'memory' }))
  const graph: AgentOSLearningGraph = { nodes, memory, edges: [{ source: nodes[0].id, target: nodes[1].id }], clusters: [], stats: { memory_nodes: 2, learned_skills: 0, memory_skill_edges: 0 } }
  const result = searchMemoryGraph(graph, ' NEEDLE ')

  expect(result.nodes).toEqual([nodes[1]])
  expect(result.edges).toEqual([])
  expect(memoryCardForNode(result.nodes[0], result.memory)).toBe(memory[1])
  expect(searchMemoryGraph(graph, '  ')).toBe(graph)
})
