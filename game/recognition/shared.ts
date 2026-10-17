export type RunePoint = {
  x: number;
  y: number;
  /** Optional event time in milliseconds, useful when points come from pointer events. */
  timestamp?: number;
};

/** One mouse-down to mouse-up segment of a rune. */
export type RuneStroke = {
  points: RunePoint[];
  /** Optional event times. When present, the gap between strokes is validated. */
  startedAt?: number;
  endedAt?: number;
  /** Aliases for callers that use start/end terminology. */
  startTime?: number;
  endTime?: number;
};

export type RuneFailureReason =
  | "too-short"
  | "stroke-count"
  | "downward-stroke"
  | "diagonal-hook"
  | "stroke-position"
  | "stroke-order"
  | "circle-shape";

export type RuneRecognitionStage =
  | "empty"
  | "first-stroke"
  | "awaiting-second-stroke"
  | "awaiting-next-stroke"
  | "second-stroke"
  | "complete"
  | "failed";

export type RuneRecognition = {
  recognized: boolean;
  reason?: RuneFailureReason;
  stage: RuneRecognitionStage;
  /** 0..1 estimate of how much of the ordered rune has been completed. */
  progress: number;
  hint: string;
  pathLength: number;
  minimumLength: number;
  strokeLengths: number[];
  completedStrokes: number;
  expectedStrokes: number;
  minimumStrokeLengths: number[];
  pauseMs?: number;
  gapDistance?: number;
};

export type RuneStrokeInput = RuneStroke | RunePoint[];

export type RecognitionValues = Pick<RuneRecognition, "recognized" | "stage" | "progress"> & {
  reason?: RuneFailureReason;
  hint?: string;
};

export const EMBER_LANCE_RUNE_HINT = "STROKE 1: LONG DOWNWARD LINE · STROKE 2: UP-RIGHT HOOK";

export function distance(a: RunePoint, b: RunePoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function clampProgress(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function runePathLength(points: RunePoint[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1], points[index]);
  return length;
}

export function runeStrokePathLength(stroke: RuneStroke) {
  return runePathLength(stroke.points);
}

export function isStroke(value: RuneStrokeInput): value is RuneStroke {
  return !Array.isArray(value) && Array.isArray(value.points);
}

function pointTime(point: RunePoint | undefined) {
  return point?.timestamp;
}

export function strokeStartTime(stroke: RuneStroke) {
  return stroke.startedAt ?? stroke.startTime ?? pointTime(stroke.points[0]);
}

export function strokeEndTime(stroke: RuneStroke) {
  return stroke.endedAt ?? stroke.endTime ?? pointTime(stroke.points[stroke.points.length - 1]);
}

export function makeRecognition(
  strokes: RuneStroke[],
  minimumLength: number,
  minimumStrokeLengths: number[],
  values: RecognitionValues,
  pauseMs?: number,
  gapDistance?: number,
  expectedStrokes = 2,
): RuneRecognition {
  const strokeLengths = strokes.map((stroke) => runePathLength(stroke.points));
  return {
    ...values,
    hint: values.hint ?? EMBER_LANCE_RUNE_HINT,
    pathLength: strokeLengths.reduce((total, length) => total + length, 0),
    minimumLength,
    strokeLengths,
    completedStrokes: Math.min(strokes.length, expectedStrokes),
    expectedStrokes,
    minimumStrokeLengths,
    ...(pauseMs === undefined ? {} : { pauseMs }),
    ...(gapDistance === undefined ? {} : { gapDistance }),
  };
}
