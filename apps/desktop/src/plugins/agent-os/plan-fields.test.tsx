import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { PlanFields, validPlanFields } from './plan-fields'

vi.mock('@hermes/plugin-sdk', async () => {
  const { AGENT_OS_LOCALES } = await import('./i18n')

  return {
    ...(await import('@/components/ui/input')),
    ...(await import('@/components/ui/textarea')),
    usePluginI18n: () => (key: keyof typeof AGENT_OS_LOCALES.en) => AGENT_OS_LOCALES.en[key]
  }
})

function Editor({ spec, changed }: { spec: unknown; changed: (raw: string) => void }) {
  const [value, setValue] = useState(JSON.stringify(spec))

  return (
    <PlanFields
      disabled={false}
      label="Action JSON"
      onChange={raw => {
        setValue(raw)
        changed(raw)
      }}
      value={value}
    />
  )
}

afterEach(cleanup)

it('edits real nested file fields without dropping hidden, verification or unknown settings', () => {
  const spec = {
    tool: 'file',
    operation: 'write_file',
    input: { path: 'before.txt', content: 'Before', token: '[redacted]' },
    expected_state: { content_contains: 'Before', sha256: 'existing-proof' },
    retry_budget: 3
  }

  const changed = vi.fn()

  render(<Editor changed={changed} spec={spec} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'File contents' }), { target: { value: 'After\n"quoted"' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'File path' }), { target: { value: 'after.txt' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Required text in file' }), { target: { value: 'After' } })
  const result = JSON.parse(changed.mock.calls.at(-1)![0])

  expect(result).toEqual({
    ...spec,
    input: { ...spec.input, path: 'after.txt', content: 'After\n"quoted"' },
    expected_state: { ...spec.expected_state, content_contains: 'After' }
  })
  expect(spec.input.content).toBe('Before')
})

it('retains advanced JSON recovery and preserves terminal command fallback and masked fields', () => {
  const changed = vi.fn()
  const mounted = render(
    <Editor changed={changed} spec={{ tool: 'terminal', operation: 'echo ready', input: { workdir: '/work' } }} />
  )

  expect((screen.getByRole('textbox', { name: 'Command' }) as HTMLTextAreaElement).value).toBe('echo ready')
  fireEvent.change(screen.getByRole('textbox', { name: 'Command' }), { target: { value: 'echo done' } })
  expect(JSON.parse(changed.mock.calls.at(-1)![0]).input).toEqual({ workdir: '/work', command: 'echo done' })
  expect(validPlanFields({ tool: 'terminal', operation: 'echo ready', input: { command: '  ' } })).toBe(false)
  expect(validPlanFields({ tool: 'terminal', operation: 'echo ready', input: {} })).toBe(true)
  fireEvent.click(screen.getByText('Advanced JSON'))
  fireEvent.change(screen.getByRole('textbox', { name: 'Action JSON' }), { target: { value: '{' } })
  expect((screen.getByRole('textbox', { name: 'Action JSON' }) as HTMLTextAreaElement).value).toBe('{')
  fireEvent.change(screen.getByRole('textbox', { name: 'Action JSON' }), {
    target: {
      value: JSON.stringify({
        tool: 'browser',
        operation: 'navigate',
        input: { url: 'https://example.test/«redacted-secret»' }
      })
    }
  })
  expect((screen.getByRole('textbox', { name: 'Page address' }) as HTMLInputElement).disabled).toBe(true)
  mounted.unmount()
  render(<Editor changed={changed} spec={{ tool: 'custom', input: { nested: { keep: true } } }} />)
  expect(screen.getByRole('textbox', { name: 'Action JSON' })).toBeTruthy()
})
