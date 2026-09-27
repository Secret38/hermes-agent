import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentOSLiveFrameMessage } from './api'
import type { AgentOSTask } from './types'
import { RuntimeObservatory } from './visual-intelligence'

const mocks = vi.hoisted(() => ({
  subscribeAgentOSLiveFrame: vi.fn()
}))
vi.mock('./api', () => ({
  subscribeAgentOSLiveFrame: (...args: unknown[]) => mocks.subscribeAgentOSLiveFrame(...args)
}))

function taskFixture(): AgentOSTask {
  return {
    id: 'task-live',
    goal: 'Observe live runtime',
    state: 'RUNNING',
    session_id: 'session-live',
    created_at: '2026-09-25T00:00:00Z',
    updated_at: '2026-09-25T00:00:00Z',
    plan: null,
    actions: [
      {
        id: 'action-cua',
        task_id: 'task-live',
        tool: 'computer_use',
        operation: 'capture',
        state: 'EXECUTING',
        risk_level: 'L1_LOW',
        permission_policy: 'explicit',
        retry_budget: 0,
        verification_required: true,
        execution_attempts: 1,
        recovery_attempts: 0,
        created_at: '2026-09-25T00:00:00Z',
        updated_at: '2026-09-25T00:00:00Z'
      }
    ],
    agents: [],
    events: [],
    metrics: {
      actions: 1,
      agents: 0,
      recoveries: 0,
      approvals: 0,
      verifications: 0,
      checkpoints: 0
    }
  }
}

describe('Agent OS Runtime Observatory live viewport', () => {
  let emit: ((frame: AgentOSLiveFrameMessage) => void) | undefined
  const close = vi.fn()

  beforeEach(() => {
    emit = undefined
    close.mockReset()
    mocks.subscribeAgentOSLiveFrame.mockReset()
    mocks.subscribeAgentOSLiveFrame.mockImplementation(
      (_taskId: string, _sessionId: string, onFrame: (frame: AgentOSLiveFrameMessage) => void) => {
        emit = onFrame
        return close
      }
    )
  })

  it('is opt-in, renders only the current live frame, and removes it on expiry or stop', () => {
    render(<RuntimeObservatory task={taskFixture()} />)

    expect(screen.queryByAltText('Live Computer Use frame for the current Agent OS task')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start live view' }))

    expect(mocks.subscribeAgentOSLiveFrame).toHaveBeenCalledWith(
      'task-live',
      'session-live',
      expect.any(Function)
    )
    expect(screen.getByText('Waiting for a fresh CUA frame')).toBeTruthy()

    act(() => {
      emit?.({
        type: 'runtime.frame',
        task_id: 'task-live',
        session_id: 'session-live',
        action_id: 'action-cua',
        mime_type: 'image/png',
        image_b64: 'ZnJhbWU=',
        width: 640,
        height: 480
      })
    })

    const image = screen.getByAltText('Live Computer Use frame for the current Agent OS task')
    expect(image.getAttribute('src')).toBe('data:image/png;base64,ZnJhbWU=')

    act(() => {
      emit?.({ type: 'runtime.frame.expired', task_id: 'task-live' })
    })
    expect(screen.queryByAltText('Live Computer Use frame for the current Agent OS task')).toBeNull()
    expect(screen.getByText('Waiting for a fresh CUA frame')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Stop live view' }))
    expect(close).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Waiting for a fresh CUA frame')).toBeNull()
  })

  it('ignores a frame for a different task even if a caller misroutes it', () => {
    render(<RuntimeObservatory task={taskFixture()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start live view' }))

    act(() => {
      emit?.({
        type: 'runtime.frame',
        task_id: 'other-task',
        session_id: 'session-live',
        action_id: 'other-action',
        mime_type: 'image/png',
        image_b64: 'b3RoZXI=',
        width: 640,
        height: 480
      })
    })

    expect(screen.queryByAltText('Live Computer Use frame for the current Agent OS task')).toBeNull()
  })
})
