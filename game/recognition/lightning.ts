import {
  clampProgress,
  distance,
  makeRecognition,
  MAX_STROKE_PAUSE_MS,
  runeStrokePathLength,
  strokeEndTime,
  strokeStartTime,
  type RunePoint,
  type RuneRecognition,
  type RuneStroke,
} from "@/game/recognition/shared";

export const LIGHTNING_RUNE_HINT = "STROKE 1: DOWN-RIGHT · STROKE 2: DOWN-LEFT · STROKE 3: DOWN-RIGHT";

/** Recognize a three-stroke zig-zag bolt, or the same bolt drawn continuously. */
export function recognizeLightningStrokes(strokes: RuneStroke[], arenaDimension: number): RuneRecognition {
  const dimension = Math.max(1, arenaDimension);
  const minimumLength = Math.max(150, dimension * 0.14);
  const minimumStrokeLengths = [Math.max(38, dimension * 0.07), Math.max(38, dimension * 0.07), Math.max(28, dimension * 0.05)];
  const makeLightningRecognition = (
    values: Parameters<typeof makeRecognition>[3],
    pauseMs?: number,
    gapDistance?: number,
  ) => makeRecognition(strokes, minimumLength, minimumStrokeLengths, values, pauseMs, gapDistance, 3);

  if (strokes.length === 0) {
    return makeLightningRecognition({ recognized: false, stage: "empty", progress: 0, reason: "too-short", hint: "START WITH A SHARP DOWN-RIGHT STROKE" });
  }
  if (strokes.length > 3) {
    return makeLightningRecognition({ recognized: false, stage: "failed", progress: 0.9, reason: "stroke-count", hint: "LIGHTNING USES EXACTLY THREE STROKES" });
  }

  const first = strokes[0];
  const firstLength = runeStrokePathLength(first);
  if (strokes.length === 1 && first.points.length >= 7 && firstLength >= minimumLength) {
    let directionChanges = 0;
    let previousHorizontalDirection = 0;
    for (let index = 1; index < first.points.length; index += 1) {
      const dx = first.points[index].x - first.points[index - 1].x;
      if (Math.abs(dx) < 3) continue;
      const horizontalDirection = Math.sign(dx);
      if (previousHorizontalDirection !== 0 && horizontalDirection !== previousHorizontalDirection) directionChanges += 1;
      previousHorizontalDirection = horizontalDirection;
    }
    const downwardTravel = first.points[first.points.length - 1].y - first.points[0].y;
    if (directionChanges >= 2 && downwardTravel >= dimension * 0.12) {
      return makeLightningRecognition({ recognized: true, stage: "complete", progress: 1, hint: "CONTINUOUS BOLT ACCEPTED" });
    }
  }

  if (first.points.length < 2 || firstLength < minimumStrokeLengths[0]) {
    return makeLightningRecognition({ recognized: false, stage: "first-stroke", progress: clampProgress(firstLength / minimumStrokeLengths[0] * 0.3), reason: "too-short", hint: "MAKE STROKE 1 A LONG DOWN-RIGHT LINE" });
  }

  const positionTolerance = Math.max(28, dimension * 0.1);
  const validateStroke = (stroke: RuneStroke, index: number) => {
    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1];
    const length = runeStrokePathLength(stroke);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const expectedDirection = index % 2 === 0 ? 1 : -1;
    return {
      length,
      dx,
      dy,
      valid: stroke.points.length >= 2 && length >= minimumStrokeLengths[index] && dy >= minimumStrokeLengths[index] * 0.25 && expectedDirection * dx >= minimumStrokeLengths[index] * 0.55 && distance(start, end) / Math.max(length, 1) >= 0.58,
    };
  };

  const firstCheck = validateStroke(first, 0);
  if (!firstCheck.valid) {
    return makeLightningRecognition({ recognized: false, stage: "failed", progress: 0.25, reason: "downward-stroke", hint: "START WITH A SHARP DOWN-RIGHT STROKE" });
  }
  if (strokes.length === 1) {
    return makeLightningRecognition({ recognized: false, stage: "awaiting-next-stroke", progress: 0.34, reason: "stroke-count", hint: "LIFT, THEN CUT DOWN-LEFT" });
  }

  for (let index = 1; index < strokes.length; index += 1) {
    const stroke = strokes[index];
    const check = validateStroke(stroke, index);
    const previous = strokes[index - 1];
    const previousEnd = previous.points[previous.points.length - 1];
    const start = stroke.points[0];
    const gapDistance = distance(previousEnd, start);
    const previousEndTime = strokeEndTime(previous);
    const currentStartTime = strokeStartTime(stroke);
    const pauseMs = previousEndTime !== undefined && currentStartTime !== undefined ? currentStartTime - previousEndTime : undefined;
    if (pauseMs !== undefined && (pauseMs < 0 || pauseMs > MAX_STROKE_PAUSE_MS)) {
      return makeLightningRecognition({ recognized: false, stage: "failed", progress: index / 3, reason: pauseMs < 0 ? "stroke-order" : "pause-too-long", hint: pauseMs < 0 ? "FINISH EACH BOLT SEGMENT IN ORDER" : "KEEP THE PAUSE BETWEEN BOLT SEGMENTS SHORT" }, pauseMs, gapDistance);
    }
    if (gapDistance > positionTolerance) {
      return makeLightningRecognition({ recognized: false, stage: "failed", progress: index / 3, reason: "stroke-position", hint: "START EACH SEGMENT NEAR THE LAST BOLT TIP" }, pauseMs, gapDistance);
    }
    if (!check.valid) {
      return makeLightningRecognition({ recognized: false, stage: "second-stroke", progress: (index + 1) / 3, reason: "diagonal-hook", hint: index === 1 ? "FINISH STROKE 2 DOWN-LEFT" : "FINISH STROKE 3 DOWN-RIGHT" }, pauseMs, gapDistance);
    }
  }

  if (strokes.length < 3) {
    return makeLightningRecognition({ recognized: false, stage: "awaiting-next-stroke", progress: 0.67, reason: "stroke-count", hint: "LIFT, THEN FINISH WITH A DOWN-RIGHT STROKE" });
  }

  const totalLength = strokes.reduce((total, stroke) => total + runeStrokePathLength(stroke), 0);
  if (totalLength < minimumLength) {
    return makeLightningRecognition({ recognized: false, stage: "failed", progress: clampProgress(totalLength / minimumLength), reason: "too-short", hint: "DRAW A LONGER LIGHTNING BOLT" });
  }

  return makeLightningRecognition({ recognized: true, stage: "complete", progress: 1, hint: "THREE-STROKE BOLT ACCEPTED" });
}

export function recognizeLightningRune(strokes: RuneStroke[], arenaDimension: number): RuneRecognition;
export function recognizeLightningRune(points: RunePoint[], arenaDimension: number): RuneRecognition;
export function recognizeLightningRune(input: RuneStroke[] | RunePoint[], arenaDimension: number): RuneRecognition {
  if (input.length === 0) return recognizeLightningStrokes([], arenaDimension);
  const first = input[0];
  const strokes = "points" in first ? (input as RuneStroke[]) : [{ points: input as RunePoint[] }];
  return recognizeLightningStrokes(strokes, arenaDimension);
}
