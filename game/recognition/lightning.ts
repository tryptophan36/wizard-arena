import {
  distance,
  makeRecognition,
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
  const minimumLength = 0;
  const minimumStrokeLengths = [0, 0, 0];
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
  if (strokes.length === 1 && first.points.length >= 7) {
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
    if (directionChanges >= 2 && downwardTravel > 0) {
      return makeLightningRecognition({ recognized: true, stage: "complete", progress: 1, hint: "CONTINUOUS BOLT ACCEPTED" });
    }
  }

  if (first.points.length < 2 || firstLength < minimumStrokeLengths[0]) {
    return makeLightningRecognition({ recognized: false, stage: "first-stroke", progress: 0, reason: "too-short", hint: "MAKE STROKE 1 A LONG DOWN-RIGHT LINE" });
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
      valid: stroke.points.length >= 2 && dy > 0 && expectedDirection * dx > 0 && distance(start, end) / Math.max(length, 1) >= 0.58,
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
    if (pauseMs !== undefined && pauseMs < 0) {
      return makeLightningRecognition({ recognized: false, stage: "failed", progress: index / 3, reason: "stroke-order", hint: "FINISH EACH BOLT SEGMENT IN ORDER" }, pauseMs, gapDistance);
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
