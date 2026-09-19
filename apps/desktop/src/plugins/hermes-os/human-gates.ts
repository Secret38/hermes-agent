import { host } from '@hermes/plugin-sdk'
import { useStore } from '@nanostores/react'

import { openSession } from '@/app/open-session'
import { $clarifyRequests } from '@/store/clarify'
import {
  $approvalRequestQueues,
  $secretRequests,
  $sudoRequests,
  $vaultCodeRequests,
  $vaultSaveLoginRequests,
  $vaultUnlockRequests
} from '@/store/prompts'
import { ownerLookupSessionRows, sessionMatchesStoredId } from '@/store/session'
import { storedSessionIdForRuntimeId } from '@/store/session-states'

export type HumanGateKind = 'approval' | 'clarify' | 'secret' | 'sudo' | 'vault-code' | 'vault-save' | 'vault-unlock'

export interface HumanGate {
  detail: string
  id: string
  kind: HumanGateKind
  label: string
  runtimeSessionId: string
  sessionLabel: string
  state: string
}

function storedIdFor(runtimeSessionId: string): string {
  return storedSessionIdForRuntimeId(runtimeSessionId) ?? runtimeSessionId
}

function labelForSession(runtimeSessionId: string): string {
  const storedId = storedIdFor(runtimeSessionId)
  const row = ownerLookupSessionRows().find(session => sessionMatchesStoredId(session, storedId))

  return row?.title?.trim() || row?.preview?.trim() || `Session #${storedId.slice(-6)}`
}

function clipped(value: string | undefined, fallback: string): string {
  const text = value?.trim() || fallback

  return text.length > 180 ? `${text.slice(0, 177)}…` : text
}

export function openHumanGateSession(gate: Pick<HumanGate, 'runtimeSessionId'>): void {
  const storedId = storedIdFor(gate.runtimeSessionId)

  openSession(storedId, to => host.navigate(to), 'stack')
}

export function useHumanGates(): HumanGate[] {
  const approvals = useStore($approvalRequestQueues)
  const clarify = useStore($clarifyRequests)
  const sudo = useStore($sudoRequests)
  const secrets = useStore($secretRequests)
  const vaultUnlock = useStore($vaultUnlockRequests)
  const vaultSave = useStore($vaultSaveLoginRequests)
  const vaultCode = useStore($vaultCodeRequests)

  const gates: HumanGate[] = []

  for (const [sessionId, queue] of Object.entries(approvals)) {
    for (const request of queue) {
      gates.push({
        detail: clipped(request.command, request.description || 'Command requires approval'),
        id: `approval:${sessionId}:${request.requestId ?? request.serverRequestId ?? gates.length}`,
        kind: 'approval',
        label: request.description?.trim() || 'Command approval',
        runtimeSessionId: request.sessionId || sessionId,
        sessionLabel: labelForSession(request.sessionId || sessionId),
        state: queue.length > 1 ? `APPROVAL · ${queue.length} QUEUED` : 'APPROVAL'
      })
    }
  }

  for (const [sessionId, request] of Object.entries(clarify)) {
    const runtimeSessionId = request.sessionId || sessionId
    const questionCount = request.questions?.length ?? 1

    gates.push({
      detail: clipped(request.question || request.questions?.[0]?.question, 'Agent needs clarification'),
      id: `clarify:${sessionId}:${request.requestId}`,
      kind: 'clarify',
      label: questionCount > 1 ? `${questionCount} clarification questions` : 'Clarification requested',
      runtimeSessionId,
      sessionLabel: labelForSession(runtimeSessionId),
      state: 'QUESTION'
    })
  }

  for (const [sessionId, request] of Object.entries(sudo)) {
    const runtimeSessionId = request.sessionId || sessionId

    gates.push({
      detail: clipped(request.command, 'Elevated command requires confirmation'),
      id: `sudo:${sessionId}:${request.requestId}`,
      kind: 'sudo',
      label: 'Elevated access requested',
      runtimeSessionId,
      sessionLabel: labelForSession(runtimeSessionId),
      state: 'SUDO'
    })
  }

  for (const [sessionId, request] of Object.entries(secrets)) {
    const runtimeSessionId = request.sessionId || sessionId

    gates.push({
      detail: `Secret required for ${request.envVar}`,
      id: `secret:${sessionId}:${request.requestId}`,
      kind: 'secret',
      label: 'Credential input requested',
      runtimeSessionId,
      sessionLabel: labelForSession(runtimeSessionId),
      state: 'SECRET'
    })
  }

  for (const [sessionId, request] of Object.entries(vaultUnlock)) {
    const runtimeSessionId = request.sessionId || sessionId

    gates.push({
      detail: `${request.displayName || request.backend} needs to be unlocked`,
      id: `vault-unlock:${sessionId}:${request.requestId}`,
      kind: 'vault-unlock',
      label: 'Password manager unlock',
      runtimeSessionId,
      sessionLabel: labelForSession(runtimeSessionId),
      state: 'VAULT'
    })
  }

  for (const [sessionId, request] of Object.entries(vaultSave)) {
    const runtimeSessionId = request.sessionId || sessionId

    gates.push({
      detail: clipped(request.site || request.origin, 'Save browser login'),
      id: `vault-save:${sessionId}:${request.requestId}`,
      kind: 'vault-save',
      label: 'Save login decision',
      runtimeSessionId,
      sessionLabel: labelForSession(runtimeSessionId),
      state: 'VAULT'
    })
  }

  for (const [sessionId, request] of Object.entries(vaultCode)) {
    const runtimeSessionId = request.sessionId || sessionId

    gates.push({
      detail: clipped(request.site, 'Verification code required'),
      id: `vault-code:${sessionId}:${request.requestId}`,
      kind: 'vault-code',
      label: 'Verification code requested',
      runtimeSessionId,
      sessionLabel: labelForSession(runtimeSessionId),
      state: '2FA'
    })
  }

  return gates
}
