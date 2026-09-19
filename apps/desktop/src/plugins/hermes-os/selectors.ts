export function activeRunIds(busyBySession: Readonly<Record<string, boolean>>): string[] {
  return Object.entries(busyBySession)
    .filter(([, busy]) => busy)
    .map(([sessionId]) => sessionId)
}

export function activeRunCount(busyBySession: Readonly<Record<string, boolean>>): number {
  return activeRunIds(busyBySession).length
}
