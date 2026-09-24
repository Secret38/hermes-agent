import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const cssPath = path.join(process.cwd(), 'src/plugins/agent-os/agent-os.css')
const css = fs.readFileSync(cssPath, 'utf8')

describe('Agent OS accessibility CSS contract', () => {
  it('publishes a keyboard-visible focus treatment for interactive controls', () => {
    expect(css).toContain(':focus-visible')
    expect(css).toContain('outline: 2px solid')
    expect(css).toContain('outline-offset: 2px')
  })

  it('supports Windows forced-colors / High Contrast mode', () => {
    expect(css).toContain('@media (forced-colors: active)')
    expect(css).toContain('background: Canvas')
    expect(css).toContain('color: CanvasText')
    expect(css).toContain('outline-color: Highlight')
  })

  it('does not rely on motion when reduced motion is requested', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})


describe('Agent OS Mission Control responsive accessibility contract', () => {
  const pagePath = path.join(process.cwd(), 'src/plugins/agent-os/page.tsx')
  const page = fs.readFileSync(pagePath, 'utf8')

  it('keeps the section navigation horizontally scrollable at high DPI', () => {
    expect(page).toContain('aria-label="Agent OS sections"')
    expect(page).toContain('overflow-x-auto')
    expect(page).toContain('shrink-0 items-center')
  })

  it('publishes active tab state and an accessible task filter label', () => {
    expect(page).toContain('aria-pressed={tab === item.id}')
    expect(page).toContain('aria-label="Filter Agent OS tasks"')
  })
})
