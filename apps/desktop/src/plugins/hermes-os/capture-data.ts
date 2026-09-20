import {
  OPERATIONS_CAPTURE_SOURCES_AREA,
  type OperationsCaptureSource,
  useContributions
} from '@hermes/plugin-sdk'

export function useMissionCaptureSources(): OperationsCaptureSource[] {
  return useContributions(OPERATIONS_CAPTURE_SOURCES_AREA)
    .map(contribution => contribution.data as OperationsCaptureSource | undefined)
    .filter(
      (source): source is OperationsCaptureSource =>
        Boolean(source?.id && source.label && typeof source.capture === 'function')
    )
}
