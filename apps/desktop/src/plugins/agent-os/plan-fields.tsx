import { Input, Textarea, usePluginI18n } from '@hermes/plugin-sdk'

interface PlanFieldsProps {
  value: string
  onChange: (value: string) => void
  label: string
  disabled: boolean
}

interface Field {
  group: 'input' | 'expected_state'
  key: string
  label:
    | 'filePath'
    | 'fileContents'
    | 'plannedCommand'
    | 'workingDirectory'
    | 'pageAddress'
    | 'expectedExactText'
    | 'expectedContainedText'
  multiline?: boolean
  fallback?: string
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function fieldsFor(spec: Record<string, unknown>): Field[] {
  if (spec.input !== undefined && !record(spec.input)) {
    return []
  }
  const operation = typeof spec.operation === 'string' ? spec.operation.toLowerCase().replace(/^browser_/, '') : ''
  let fields: Field[] = []

  if (spec.tool === 'file' && ['write', 'write_file', 'read', 'read_file'].includes(operation)) {
    fields = [{ group: 'input', key: 'path', label: 'filePath' }]

    if (['write', 'write_file'].includes(operation)) {
      fields.push({ group: 'input', key: 'content', label: 'fileContents', multiline: true })
    }
  } else if (spec.tool === 'browser' && ['navigate', 'open'].includes(operation)) {
    fields = [{ group: 'input', key: 'url', label: 'pageAddress' }]
  } else if (spec.tool === 'terminal' && typeof spec.operation === 'string') {
    fields = [
      { group: 'input', key: 'command', label: 'plannedCommand', multiline: true, fallback: spec.operation },
      { group: 'input', key: 'workdir', label: 'workingDirectory' }
    ]
  }

  if (spec.tool === 'file' && fields.length && record(spec.expected_state)) {
    for (const [key, label] of [
      ['content_equals', 'expectedExactText'],
      ['content_contains', 'expectedContainedText']
    ] as const) {
      if (typeof spec.expected_state[key] === 'string') {
        fields.push({ group: 'expected_state', key, label, multiline: true })
      }
    }
  }

  return fields.filter(field => {
    const group = spec[field.group]
    const value = record(group) ? group[field.key] : undefined

    return value === undefined || typeof value === 'string'
  })
}

export function validPlanFields(spec: Record<string, unknown>): boolean {
  return fieldsFor(spec).every(field => {
    if (!['path', 'url', 'command'].includes(field.key)) {
      return true
    }
    const candidate = spec[field.group]
    const group = record(candidate) ? candidate : {}
    const value = group[field.key] ?? field.fallback

    return typeof value === 'string' && value.trim().length > 0
  })
}

export function PlanFields({ value, onChange, label, disabled }: PlanFieldsProps) {
  const t = usePluginI18n('agent-os')
  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch {
    parsed = undefined
  }
  const spec = record(parsed) ? parsed : undefined
  const fields = spec ? fieldsFor(spec) : []

  const raw = (
    <Textarea
      aria-label={label}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
      rows={8}
      value={value}
    />
  )

  if (!spec || fields.length === 0) {
    return raw
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-(--ui-text-secondary)">{t('planFieldsNote')}</p>
      {fields.map(field => {
        const candidate = spec[field.group]
        const group = record(candidate) ? candidate : {}
        const current = typeof group[field.key] === 'string' ? (group[field.key] as string) : (field.fallback ?? '')
        const Control = field.multiline ? Textarea : Input

        return (
          <label className="block space-y-1" key={`${field.group}.${field.key}`}>
            <span>{t(field.label)}</span>
            <Control
              disabled={disabled || /\[redacted|«redacted/i.test(current)}
              onChange={event =>
                onChange(
                  JSON.stringify({ ...spec, [field.group]: { ...group, [field.key]: event.target.value } }, null, 2)
                )
              }
              value={current}
            />
          </label>
        )
      })}
      <details>
        <summary className="cursor-pointer text-(--ui-text-secondary)">{t('advancedPlanJSON')}</summary>
        {raw}
      </details>
    </div>
  )
}
