import type { TraceEvent, TraceKind, TraceStatus } from "./types";

export function trace(
  kind: TraceKind,
  label: string,
  detail: string,
  status: TraceStatus,
  durationMs?: number,
): TraceEvent {
  return {
    id: `trace-${Math.random().toString(36).slice(2, 9)}`,
    kind,
    label,
    detail,
    status,
    durationMs,
    createdAt: new Date().toISOString(),
  };
}
