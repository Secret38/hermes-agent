import { describe, expect, it } from 'vitest'

import { approvalProvenanceFor, buildHumanGates } from './human-gates'

describe('Agent OS human gates', () => {
  it('keeps approval mode unknown until a profile mode is actually confirmed', () => {
    expect(
      approvalProvenanceFor(
        {
          allowPermanent: false,
          allowSession: true,
          command: 'git clean -fdx',
          description: 'destructive clean',
          patternKey: 'git.clean',
          patternKeys: ['git.clean', 'filesystem.delete'],
          sessionId: 'unlisted-runtime',
          toolName: 'terminal'
        },
        'unlisted-runtime'
      )
    ).toMatchObject({
      allowPermanent: false,
      allowSession: true,
      mode: 'unknown',
      patternKeys: ['git.clean', 'filesystem.delete'],
      profile: 'default',
      smartDenied: false,
      toolName: 'terminal'
    })
  })

  it('treats an explicit smart-denied request as proof of Smart mode', () => {
    expect(
      approvalProvenanceFor(
        {
          command: 'rm -rf generated',
          description: 'recursive delete',
          sessionId: 'runtime',
          smartDenied: true
        },
        'runtime'
      ).mode
    ).toBe('smart')
  })

  it('uses a confirmed mode resolver without changing policy provenance', () => {
    const provenance = approvalProvenanceFor(
      {
        command: 'rm build.log',
        description: 'delete file',
        patternKey: 'filesystem.delete',
        sessionId: 'runtime'
      },
      'runtime',
      () => 'manual'
    )

    expect(provenance.mode).toBe('manual')
    expect(provenance.patternKeys).toEqual(['filesystem.delete'])
  })


  it('projects every existing blocking prompt family without inventing state', () => {
    const gates = buildHumanGates(
      {
        approvals: {
          runtimeA: [
            {
              command: 'rm -rf ./build',
              description: 'Delete generated build output',
              requestId: 'approval-1',
              sessionId: 'runtimeA'
            }
          ]
        },
        clarify: {
          runtimeB: {
            choices: ['A', 'B'],
            multiSelect: false,
            question: 'Which deployment target?',
            requestId: 'clarify-1',
            sessionId: 'runtimeB'
          }
        },
        secrets: {
          runtimeC: {
            envVar: 'DEPLOY_TOKEN',
            prompt: 'Enter the production deploy token',
            requestId: 'secret-1',
            sessionId: 'runtimeC'
          }
        },
        sudo: {
          runtimeD: {
            command: 'apt install package',
            requestId: 'sudo-1',
            sessionId: 'runtimeD'
          }
        },
        vaultCode: {
          runtimeE: {
            hint: 'Authenticator app',
            requestId: 'code-1',
            sessionId: 'runtimeE',
            site: 'example.com'
          }
        },
        vaultSave: {
          runtimeF: {
            origin: 'https://example.com',
            requestId: 'save-1',
            sessionId: 'runtimeF',
            site: 'example.com'
          }
        },
        vaultUnlock: {
          runtimeG: {
            backend: '1password',
            displayName: '1Password',
            requestId: 'unlock-1',
            sessionId: 'runtimeG'
          }
        }
      },
      runtimeId => 'session:' + runtimeId
    )

    expect(gates.map(gate => gate.kind)).toEqual([
      'approval',
      'clarify',
      'sudo',
      'secret',
      'vault-unlock',
      'vault-save',
      'vault-code'
    ])
    expect(gates.every(gate => gate.sessionLabel === 'session:' + gate.runtimeSessionId)).toBe(true)
  })

  it('counts an approval queue entry by entry and marks the queue depth', () => {
    const gates = buildHumanGates(
      {
        approvals: {
          runtimeA: [
            {
              command: 'first',
              description: 'First command',
              requestId: 'a',
              sessionId: 'runtimeA'
            },
            {
              command: 'second',
              description: 'Second command',
              requestId: 'b',
              sessionId: 'runtimeA'
            }
          ]
        },
        clarify: {},
        secrets: {},
        sudo: {},
        vaultCode: {},
        vaultSave: {},
        vaultUnlock: {}
      },
      () => 'Session'
    )

    expect(gates).toHaveLength(2)
    expect(gates.map(gate => gate.state)).toEqual(['APPROVAL · 2 QUEUED', 'APPROVAL · 2 QUEUED'])
  })

  it('does not project a secret prompt body into the control plane', () => {
    const gates = buildHumanGates(
      {
        approvals: {},
        clarify: {},
        secrets: {
          runtimeC: {
            envVar: 'API_KEY',
            prompt: 'highly sensitive explanatory prompt',
            requestId: 'secret-1',
            sessionId: 'runtimeC'
          }
        },
        sudo: {},
        vaultCode: {},
        vaultSave: {},
        vaultUnlock: {}
      },
      () => 'Session'
    )

    expect(gates[0]?.detail).toBe('Secret required for API_KEY')
    expect(gates[0]?.detail).not.toContain('highly sensitive')
  })
})
