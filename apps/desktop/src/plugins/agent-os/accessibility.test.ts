import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

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
