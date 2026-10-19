import { usePluginI18n } from '@hermes/plugin-sdk'

import type { AgentOSLearningEdge } from './types'

export function MemoryEvidence({ edge }: { edge: AgentOSLearningEdge }) {
  const t = usePluginI18n('agent-os')

  if (edge.kind === 'declared') {
    return <p className="text-xs text-(--ui-text-secondary)">{t('declaredRelation')}: {edge.declared_by?.join(', ') || t('unknownEvidence')}</p>
  }

  if (edge.kind === 'lexical') {
    return <div className="text-xs text-(--ui-text-secondary)">
      <p>{t('lexicalRelation')}</p>
      {edge.shared_terms?.length ? <p>{t('sharedTerms')}: {edge.shared_terms.join(', ')}</p> : null}
      {edge.name_match && <p>{t('matchedSkillName')}: {edge.target}</p>}
    </div>
  }

  return <p className="text-xs text-(--ui-text-secondary)">{t('unknownEvidence')}</p>
}
