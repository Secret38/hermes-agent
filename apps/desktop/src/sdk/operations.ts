/** Mission Control uses the same live stores and actions as the desktop.
 * Keep these bindings in the SDK so plugins do not fork state or bypass the
 * canonical approval, session-navigation, and workspace controllers.
 */
export type { SidebarProjectTree } from '@/app/chat/sidebar/projects/workspace-groups'
export {
  OPERATIONS_TASK_SOURCES_AREA,
  type OperationsCaptureInput,
  type OperationsRunInspection,
  type OperationsTask,
  type OperationsTaskExecution,
  type OperationsTaskLog,
  type OperationsTaskSnapshot,
  type OperationsTaskSource
} from '@/contrib/operations'
export { useContributions } from '@/contrib/react/use-contributions'
export { $approvalModes, type ApprovalMode } from '@/store/approval-mode'
export { $clarifyRequests, type ClarifyRequest } from '@/store/clarify'
export { $liveSessionSnapshots, liveSessionScopeKey, type LiveSessionSnapshotItem } from '@/store/live-sessions'
export { revealDesktopPane } from '@/store/pane-focus'
export { openBrowserTab } from '@/store/preview'
export {
  $projectTree,
  $projectTreeLoading,
  fetchProjectSessions,
  goToProject,
  refreshProjectTree
} from '@/store/projects'
export {
  $approvalRequestQueues,
  $secretRequests,
  $sudoRequests,
  $vaultCodeRequests,
  $vaultSaveLoginRequests,
  $vaultUnlockRequests,
  type ApprovalChoice,
  type ApprovalRequest,
  resolveApprovalRequest,
  type SecretRequest,
  type SudoRequest,
  type VaultCodeRequest,
  type VaultSaveLoginRequest,
  type VaultUnlockRequest
} from '@/store/prompts'
export { revealReview } from '@/store/review'
export {
  $resumeFailedSessionId,
  $workspaceCwdOwner,
  knownSessionProfile,
  ownerLookupSessionRows,
  sessionMatchesStoredId
} from '@/store/session'
export { storedSessionIdForRuntimeId } from '@/store/session-states'
export { $subagentsBySession, type SubagentProgress } from '@/store/subagents'
export type { SessionInfo } from '@/types/hermes'
