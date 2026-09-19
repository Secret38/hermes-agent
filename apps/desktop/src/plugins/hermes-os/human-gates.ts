import { useStore } from '@nanostores/react'

import { $clarifyRequests, type ClarifyRequest } from '@/store/clarify'
import { $gateway } from '@/store/gateway'
import {
  $approvalRequestQueues,
  $secretRequests,
  $sudoRequests,
  $vaultCodeRequests,
  $vaultSaveLoginRequests,
  $vaultUnlockRequests,
  type ApprovalChoice,
  type ApprovalRequest,
  type SecretRequest,
  type SudoRequest,
  type VaultCodeRequest,
  type VaultSaveLoginRequest,
  type VaultUnlockRequest,
  resolveApprovalRequest
} from '@/store/prompts'
import { ownerLookupSessionRows, sessionMatchesStoredId } from '@/store/session'

import { openHermesSession, storedHermesSessionId } from './session-navigation'

export type HumanGateKind = 'approval' | 'clarify' | 'secret' | 'sudo' | 'vault-code' | 'vault-save' | 'vault-unlock'

export interface HumanGate {
  approvalRequest?: ApprovalRequest
  detail: string
  id: string
  kind: HumanGateKind
  label: string
  runtimeSessionId: string
  sessionLabel: string
  state: string
}

function labelForSession(runtimeSessionId: string): string {
  const storedId = storedHermesSessionId(runtimeSessionId)
  const row = ownerLookupSessionRows().find(session => sessionMatchesStoredId(session, storedId))

  return row?.title?.trim() || row?.preview?.trim() || `Session #${storedId.slice(-6)}`
}

function clipped(value: string | undefined, fallback: string): string {
  const text = value?.trim() || fallback

  return text.length > 180 ? `${text.slice(0, 177)}…` : text
}

export function openHumanGateSession(gate: Pick<HumanGate, 'runtimeSessionId'>): void {
  openHermesSession(gate.runtimeSessionId)
}

export async function resolveHumanGateApproval(
  gate: Pick<HumanGate, 'approvalRequest' | 'kind'>,
  choice: Extract<ApprovalChoice, 'deny' | 'once'>
): Promise<boolean> {
  if (gate.kind !== 'approval' || !gate.approvalRequest) {
    return false
  }

  const gateway = $gateway.get()

  if (!gateway) {
    throw new Error('Hermes gateway is not connected')
  }

  return resolveApprovalRequest(gateway, gate.approvalRequest, choice)
}

export interface HumanGatePromptMaps {
  approvals: Readonly<Record<string, readonly ApprovalRequest[]>>
  clarify: Readonly<Record<string, ClarifyRequest>>
  secrets: Readonly<Record<string, SecretRequest>>
  sudo: Readonly<Record<string, SudoRequest>>
  vaultCode: Readonly<Record<string, VaultCodeRequest>>
  vaultSave: Readonly<Record<string, VaultSaveLoginRequest>>
  vaultUnlock: Readonly<Record<string, VaultUnlockRequest>>
}

export function buildHumanGates(
  maps: HumanGatePromptMaps,
  sessionLabel: (runtimeSessionId: string) => string = labelForSession
): HumanGate[] {
  const gates: HumanGate[] = []

  for (const [sessionId, queue] of Object.entries(maps.approvals)) {
    for (const request of queue) {
      const runtimeSessionId = request.sessionId || sessionId

      gates.push({
        approvalRequest: request,
        detail: clipped(request.command, request.description || 'Command requires approval'),
        id: `approval:${sessionId}:${request.requestId ?? request.serverRequestId ?? gates.length}`,
        kind: 'approval',
        label: request.description?.trim() || 'Command approval',
        runtimeSessionId,
        sessionLabel: sessionLabel(runtimeSessionId),
        state: queue.length > 1 ? `APPROVAL · ${queue.length} QUEUED` : 'APPROVAL'
      })
    }
  }

  for (const [sessionId, request] of Object.entries(maps.clarify)) {
    const runtimeSessionId = request.sessionId || sessionId
    const questionCount = request.questions?.length ?? 1

    gates.push({
      detail: clipped(request.question || request.questions?.[0]?.question, 'Agent needs clarification'),
      id: `clarify:${sessionId}:${request.requestId}`,
      kind: 'clarify',
      label: questionCount > 1 ? `${questionCount} clarification questions` : 'Clarification requested',
      runtimeSessionId,
      sessionLabel: sessionLabel(runtimeSessionId),
      state: 'QUESTION'
    })
  }

  for (const [sessionId, request] of Object.entries(maps.sudo)) {
    const runtimeSessionId = request.sessionId || sessionId

    gates.push({
      detail: clipped(request.command, 'Elevated command requires confirmation'),
      id: `sudo:${sessionId}:${request.requestId}`,
      kind: 'sudo',
      label: 'Elevated access requested',
      runtimeSessionId,
      sessionLabel: sessionLabel(runtimeSessionId),
      state: 'SUDO'
    })
  }

  for (const [sessionId, request] of Object.entries(maps.secrets)) {
    const runtimeSessionId = request.sessionId || sessionId

    gates.push({
      detail: `Secret required for ${request.envVar}`,
      id: `secret:${sessionId}:${request.requestId}`,
      kind: 'secret',
      label: 'Credential input requested',
      runtimeSessionId,
      sessionLabel: sessionLabel(runtimeSessionId),
      state: 'SECRET'
    })
  }

  for (const [sessionId, request] of Object.entries(maps.vaultUnlock)) {
    const runtimeSessionId = request.sessionId || sessionId

    gates.push({
      detail: `${request.displayName || request.backend} needs to be unlocked`,
      id: `vault-unlock:${sessionId}:${request.requestId}`,
      kind: 'vault-unlock',
      label: 'Password manager unlock',
      runtimeSessionId,
      sessionLabel: sessionLabel(runtimeSessionId),
      state: 'VAULT'
    })
  }

  for (const [sessionId, request] of Object.entries(maps.vaultSave)) {
    const runtimeSessionId = request.sessionId || sessionId

    gates.push({
      detail: clipped(request.site || request.origin, 'Save browser login'),
      id: `vault-save:${sessionId}:${request.requestId}`,
      kind: 'vault-save',
      label: 'Save login decision',
      runtimeSessionId,
      sessionLabel: sessionLabel(runtimeSessionId),
      state: 'VAULT'
    })
  }

  for (const [sessionId, request] of Object.entries(maps.vaultCode)) {
    const runtimeSessionId = request.sessionId || sessionId

    gates.push({
      detail: clipped(request.site, 'Verification code required'),
      id: `vault-code:${sessionId}:${request.requestId}`,
      kind: 'vault-code',
      label: 'Verification code requested',
      runtimeSessionId,
      sessionLabel: sessionLabel(runtimeSessionId),
      state: '2FA'
    })
  }

  return gates
}

export function useHumanGates(): HumanGate[] {
  return buildHumanGates({
    approvals: useStore($approvalRequestQueues),
    clarify: useStore($clarifyRequests),
    secrets: useStore($secretRequests),
    sudo: useStore($sudoRequests),
    vaultCode: useStore($vaultCodeRequests),
    vaultSave: useStore($vaultSaveLoginRequests),
    vaultUnlock: useStore($vaultUnlockRequests)
  })
}
