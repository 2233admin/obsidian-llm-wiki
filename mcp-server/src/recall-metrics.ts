export interface RecallTthwRecorderOptions {
  enabled?: boolean;
  startedAtMs?: number;
  now?: () => number;
  emit?: (event: { event: "recall_first_success"; elapsedMs: number; citations: number }) => void;
}

export interface RecallTthwRecorder {
  record(citationCount: number): void;
}

export function createRecallTthwRecorder(options: RecallTthwRecorderOptions = {}): RecallTthwRecorder {
  const enabled = options.enabled ?? process.env.VAULT_MIND_TTHW_METRICS === "1";
  const startedAtMs = options.startedAtMs ?? Date.now();
  const now = options.now ?? Date.now;
  const emit = options.emit ?? ((event) => process.stderr.write(`${JSON.stringify(event)}\n`));
  let recorded = false;

  return {
    record(citationCount: number): void {
      if (!enabled || recorded || citationCount <= 0) return;
      recorded = true;
      emit({
        event: "recall_first_success",
        elapsedMs: Math.max(0, now() - startedAtMs),
        citations: citationCount,
      });
    },
  };
}

export const processRecallTthw = createRecallTthwRecorder();
