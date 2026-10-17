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
  | "pause-too-long";

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

export const EMBER_LANCE_RUNE_HINT = "STROKE 1: LONG DOWNWARD LINE · STROKE 2: UP-RIGHT HOOK";
export const LIGHTNING_RUNE_HINT = "STROKE 1: DOWN-RIGHT · STROKE 2: DOWN-LEFT · STROKE 3: DOWN-RIGHT";

const BASE_MINIMUM_LENGTH = 120;
const MAX_STROKE_PAUSE_MS = 900;

function distance(a: RunePoint, b: RunePoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(1, value));
}

function isStroke(value: RuneStrokeInput): value is RuneStroke {
  return !Array.isArray(value) && Array.isArray(value.points);
}

function pointTime(point: RunePoint | undefined) {
  return point?.timestamp;
}

function strokeStartTime(stroke: RuneStroke) {
  return stroke.startedAt ?? stroke.startTime ?? pointTime(stroke.points[0]);
}

function strokeEndTime(stroke: RuneStroke) {
  return stroke.endedAt ?? stroke.endTime ?? pointTime(stroke.points[stroke.points.length - 1]);
}

function makeRecognition(
  strokes: RuneStroke[],
  minimumLength: number,
  minimumStrokeLengths: number[],
  values: Pick<RuneRecognition, "recognized" | "stage" | "progress"> & { reason?: RuneFailureReason; hint?: string },
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

export function runePathLength(points: RunePoint[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1], points[index]);
  return length;
}

export function runeStrokePathLength(stroke: RuneStroke) {
  return runePathLength(stroke.points);
}

/**
 * Recognize the ordered, mouse-lift version of Ember Lance.
 *
 * Stroke one is a long, mostly vertical downward line. Stroke two must begin
 * close to stroke one's endpoint and travel up and right as a diagonal hook.
 * Timing is optional, but when supplied a pause over 900ms is rejected.
 */
export function recognizeEmberLanceStrokes(strokes: RuneStroke[], arenaDimension: number): RuneRecognition {
  const dimension = Math.max(1, arenaDimension);
  const minimumLength = Math.max(BASE_MINIMUM_LENGTH, dimension * 0.12);
  const minimumFirstLength = Math.max(55, dimension * 0.1);
  const minimumHookLength = Math.max(28, dimension * 0.055);
  const minimumStrokeLengths: [number, number] = [minimumFirstLength, minimumHookLength];
  const normalized = strokes;

  if (normalized.length === 0) {
    return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "empty",
      progress: 0,
      reason: "too-short",
      hint: "START WITH A LONG DOWNWARD STROKE",
    });
  }

  if (normalized.length > 2) {
    return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: 0.9,
      reason: "stroke-count",
      hint: "EMBER LANCE USES EXACTLY TWO STROKES",
    });
  }

  const first = normalized[0];
  const firstLength = runeStrokePathLength(first);

  // Ember Lance is forgiving about the mouse lift: a player may draw the
  // simple rune continuously, or pause at the turn and continue as stroke 2.
  // Check the continuous form before treating a single stroke as an incomplete
  // first line.
  if (normalized.length === 1 && first.points.length >= 4 && firstLength >= minimumLength) {
    const start = first.points[0];
    let lowestIndex = 0;
    for (let index = 1; index < first.points.length; index += 1) {
      if (first.points[index].y > first.points[lowestIndex].y) lowestIndex = index;
    }
    const lowest = first.points[lowestIndex];
    const end = first.points[first.points.length - 1];
    const downwardTravel = lowest.y - start.y;
    const sidewaysTravel = Math.abs(lowest.x - start.x);
    const minimumDrop = Math.max(35, dimension * 0.075);
    const hookDx = end.x - lowest.x;
    const hookRise = lowest.y - end.y;
    const hookLength = runePathLength(first.points.slice(lowestIndex));
    const straightness = distance(start, lowest) / Math.max(runePathLength(first.points.slice(0, lowestIndex + 1)), 1);
    const minimumHook = Math.max(28, dimension * 0.055);

    if (
      lowestIndex >= 2 &&
      lowestIndex <= first.points.length - 3 &&
      downwardTravel >= minimumDrop &&
      sidewaysTravel <= Math.max(24, downwardTravel * 0.65) &&
      hookLength >= minimumHook &&
      hookDx >= minimumHook * 0.6 &&
      hookRise >= minimumHook * 0.25 &&
      hookDx >= hookRise * 0.45 &&
      straightness >= 0.72
    ) {
      return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
        recognized: true,
        stage: "complete",
        progress: 1,
        hint: "CONTINUOUS RUNE ACCEPTED",
      });
    }
  }

  if (first.points.length < 2 || firstLength < minimumFirstLength) {
    return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "first-stroke",
      progress: clampProgress(firstLength / minimumFirstLength * 0.45),
      reason: "too-short",
      hint: "MAKE STROKE 1 A LONG DOWNWARD LINE",
    });
  }

  const firstStart = first.points[0];
  const firstEnd = first.points[first.points.length - 1];
  const downwardTravel = firstEnd.y - firstStart.y;
  const sidewaysTravel = Math.abs(firstEnd.x - firstStart.x);
  const minimumDrop = Math.max(35, dimension * 0.075);
  const straightness = distance(firstStart, firstEnd) / firstLength;
  const maxUpwardBacktrack = Math.max(12, downwardTravel * 0.22);
  const highestAfterDrop = Math.max(...first.points.map((point) => point.y));
  const upwardBacktrack = highestAfterDrop - firstEnd.y;

  if (
    downwardTravel < minimumDrop ||
    sidewaysTravel > Math.max(24, downwardTravel * 0.65) ||
    straightness < 0.72 ||
    upwardBacktrack > maxUpwardBacktrack
  ) {
    return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: 0.35,
      reason: "downward-stroke",
      hint: "START WITH A STRAIGHT, LONG DOWNWARD STROKE",
    });
  }

  if (normalized.length === 1) {
    return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "awaiting-second-stroke",
      progress: 0.5,
      reason: "stroke-count",
      hint: "LIFT, THEN ADD THE UP-RIGHT HOOK",
    });
  }

  const second = normalized[1];
  const secondLength = runeStrokePathLength(second);
  if (second.points.length < 2 || secondLength < minimumHookLength) {
    return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "second-stroke",
      progress: 0.72,
      reason: "diagonal-hook",
      hint: "FINISH WITH AN UP-RIGHT DIAGONAL HOOK",
    });
  }

  const secondStart = second.points[0];
  const secondEnd = second.points[second.points.length - 1];
  const gapDistance = distance(firstEnd, secondStart);
  const positionTolerance = Math.max(24, dimension * 0.1);
  const firstEndTime = strokeEndTime(first);
  const secondStartTime = strokeStartTime(second);
  const pauseMs = firstEndTime !== undefined && secondStartTime !== undefined ? secondStartTime - firstEndTime : undefined;

  if (pauseMs !== undefined && pauseMs < 0) {
    return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: 0.5,
      reason: "stroke-order",
      hint: "FINISH THE DOWNWARD STROKE BEFORE STARTING THE HOOK",
    }, pauseMs, gapDistance);
  }

  if (pauseMs !== undefined && pauseMs > MAX_STROKE_PAUSE_MS) {
    return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: 0.5,
      reason: "pause-too-long",
      hint: "KEEP THE PAUSE BETWEEN STROKES SHORT",
    }, pauseMs, gapDistance);
  }

  if (gapDistance > positionTolerance) {
    return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: 0.55,
      reason: "stroke-position",
      hint: "START THE UP-RIGHT HOOK NEAR THE END OF STROKE 1",
    }, pauseMs, gapDistance);
  }

  const hookDx = secondEnd.x - secondStart.x;
  const hookRise = secondStart.y - secondEnd.y;
  const hookLength = secondLength;
  const hookStraightness = distance(secondStart, secondEnd) / Math.max(hookLength, 1);
  if (
    hookDx < minimumHookLength * 0.6 ||
    hookRise < minimumHookLength * 0.25 ||
    hookDx < hookRise * 0.45 ||
    hookStraightness < 0.58
  ) {
    return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "second-stroke",
      progress: 0.72,
      reason: "diagonal-hook",
      hint: "FINISH WITH AN UP-RIGHT DIAGONAL HOOK",
    }, pauseMs, gapDistance);
  }

  const totalLength = firstLength + hookLength;
  if (totalLength < minimumLength) {
    return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: clampProgress(totalLength / minimumLength),
      reason: "too-short",
      hint: "DRAW A LONGER EMBER LANCE RUNE",
    }, pauseMs, gapDistance);
  }

  return makeRecognition(normalized, minimumLength, minimumStrokeLengths, {
    recognized: true,
    stage: "complete",
    progress: 1,
  }, pauseMs, gapDistance);
}

/** Compatibility entry point: accepts the old continuous path and new strokes. */
export function recognizeEmberLanceRune(strokes: RuneStroke[], arenaDimension: number): RuneRecognition;
export function recognizeEmberLanceRune(points: RunePoint[], arenaDimension: number): RuneRecognition;
export function recognizeEmberLanceRune(input: RuneStroke[] | RunePoint[], arenaDimension: number): RuneRecognition {
  if (input.length === 0) return recognizeEmberLanceStrokes([], arenaDimension);
  const first = input[0];
  const strokes = isStroke(first as RuneStrokeInput) ? (input as RuneStroke[]) : [{ points: input as RunePoint[] }];
  return recognizeEmberLanceStrokes(strokes, arenaDimension);
}

/** Explicit name for callers that want to make the mouse-lift contract clear. */
export const recognizeEmberLanceMultiStroke = recognizeEmberLanceStrokes;

/** Recognize one closed, four-corner square suitable for the Aegis ward. */
export function recognizeSquareStrokes(strokes: RuneStroke[], arenaDimension: number): RuneRecognition {
  const dimension = Math.max(1, arenaDimension);
  const minimumLength = Math.max(130, dimension * 0.16);
  const minimumStrokeLengths = [minimumLength];
  const makeShieldRecognition = (values: Pick<RuneRecognition, "recognized" | "stage" | "progress"> & { reason?: RuneFailureReason; hint?: string }) =>
    makeRecognition(strokes, minimumLength, minimumStrokeLengths, values, undefined, undefined, 1);

  if (strokes.length === 0) {
    return makeShieldRecognition({ recognized: false, stage: "empty", progress: 0, reason: "too-short", hint: "START WITH ONE CLOSED SQUARE" });
  }
  if (strokes.length > 1) {
    return makeShieldRecognition({ recognized: false, stage: "failed", progress: 0.8, reason: "stroke-count", hint: "AEGIS USES ONE CLOSED SQUARE" });
  }

  const points = strokes[0].points;
  const pathLength = runePathLength(points);
  if (points.length < 6 || pathLength < minimumLength) {
    return makeShieldRecognition({ recognized: false, stage: "first-stroke", progress: clampProgress(pathLength / minimumLength), reason: "too-short", hint: "TRACE A LARGER SQUARE" });
  }

  const start = points[0];
  const end = points[points.length - 1];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const width = maxX - minX; const height = maxY - minY;
  const closureDistance = distance(start, end);
  const isClosed = closureDistance <= Math.max(26, dimension * 0.07);
  let axisChanges = 0;
  let previousAxis = 0;
  let axisAlignmentTotal = 0;
  let axisAlignmentSamples = 0;
  let sharpTurns = 0;
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index].x - points[index - 1].x;
    const dy = points[index].y - points[index - 1].y;
    if (Math.hypot(dx, dy) < 3) continue;
    const axis = Math.abs(dx) >= Math.abs(dy) ? 1 : 2;
    axisAlignmentTotal += Math.max(Math.abs(dx), Math.abs(dy)) / Math.hypot(dx, dy);
    axisAlignmentSamples += 1;
    if (previousAxis !== 0 && axis !== previousAxis) axisChanges += 1;
    previousAxis = axis;
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incoming = { x: current.x - previous.x, y: current.y - previous.y };
    const outgoing = { x: next.x - current.x, y: next.y - current.y };
    const incomingLength = Math.hypot(incoming.x, incoming.y);
    const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
    if (incomingLength < 3 || outgoingLength < 3) continue;
    const cosine = (incoming.x * outgoing.x + incoming.y * outgoing.y) / (incomingLength * outgoingLength);
    if (cosine < 0.45) sharpTurns += 1;
  }
  const aspectRatio = width / Math.max(height, 1);
  const startsOnPerimeter = start.x <= minX + width * 0.25 || start.x >= maxX - width * 0.25 || start.y <= minY + height * 0.25 || start.y >= maxY - height * 0.25;
  const averageAxisAlignment = axisAlignmentTotal / Math.max(axisAlignmentSamples, 1);
  const isSquareProportioned = aspectRatio >= 0.7 && aspectRatio <= 1.3 && height >= dimension * 0.12;
  if (isClosed && startsOnPerimeter && axisChanges >= 3 && sharpTurns >= 2 && averageAxisAlignment >= 0.86 && isSquareProportioned) {
    return makeShieldRecognition({ recognized: true, stage: "complete", progress: 1, hint: "AEGIS SQUARE ACCEPTED" });
  }

  return makeShieldRecognition({ recognized: false, stage: "first-stroke", progress: 0.8, reason: closureDistance > Math.max(26, dimension * 0.07) ? "stroke-position" : "diagonal-hook", hint: "CLOSE THE SQUARE WHERE YOU STARTED" });
}

export function recognizeSquareRune(strokes: RuneStroke[], arenaDimension: number) {
  return recognizeSquareStrokes(strokes, arenaDimension);
}

/** Backwards-compatible name for callers that describe the ward by its effect. */
export const recognizeShieldStrokes = recognizeSquareStrokes;

/** Recognize an Aegis square followed by its two crossing diagonals. */
export function recognizeSquareCrossStrokes(strokes: RuneStroke[], arenaDimension: number): RuneRecognition {
  const dimension = Math.max(1, arenaDimension);
  const minimumLength = Math.max(220, dimension * 0.24);
  const minimumStrokeLengths = [Math.max(130, dimension * 0.16), Math.max(34, dimension * 0.05), Math.max(34, dimension * 0.05)];
  const makeCrossRecognition = (values: Pick<RuneRecognition, "recognized" | "stage" | "progress"> & { reason?: RuneFailureReason; hint?: string }) =>
    makeRecognition(strokes, minimumLength, minimumStrokeLengths, values, undefined, undefined, 3);

  if (strokes.length === 0) {
    return makeCrossRecognition({ recognized: false, stage: "empty", progress: 0, reason: "too-short", hint: "START WITH A CLOSED SQUARE" });
  }
  if (strokes.length > 3) {
    return makeCrossRecognition({ recognized: false, stage: "failed", progress: 0.9, reason: "stroke-count", hint: "AEGIS USES ONE SQUARE AND TWO DIAGONALS" });
  }

  const square = recognizeSquareStrokes([strokes[0]], dimension);
  if (!square.recognized) {
    return makeCrossRecognition({ recognized: false, stage: square.stage, progress: square.progress * 0.34, reason: square.reason, hint: "TRACE A CLOSED SQUARE FIRST" });
  }
  if (strokes.length === 1) {
    return makeCrossRecognition({ recognized: false, stage: "awaiting-next-stroke", progress: 0.34, reason: "stroke-count", hint: "LIFT, THEN DRAW THE FIRST DIAGONAL" });
  }

  const squarePoints = strokes[0].points;
  const minX = Math.min(...squarePoints.map((point) => point.x));
  const maxX = Math.max(...squarePoints.map((point) => point.x));
  const minY = Math.min(...squarePoints.map((point) => point.y));
  const maxY = Math.max(...squarePoints.map((point) => point.y));
  const boundaryTolerance = Math.max(26, dimension * 0.08);
  const isNearBoundary = (point: RunePoint) => Math.min(Math.abs(point.x - minX), Math.abs(point.x - maxX), Math.abs(point.y - minY), Math.abs(point.y - maxY)) <= boundaryTolerance;
  const diagonal = (stroke: RuneStroke) => {
    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1];
    const length = runeStrokePathLength(stroke);
    const straightness = distance(start, end) / Math.max(length, 1);
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const inside = (point: RunePoint) => point.x >= minX - boundaryTolerance && point.x <= maxX + boundaryTolerance && point.y >= minY - boundaryTolerance && point.y <= maxY + boundaryTolerance;
    return { length, dx, dy, valid: stroke.points.length >= 2 && length >= minimumStrokeLengths[1] && straightness >= 0.68 && Math.abs(dx) >= minimumStrokeLengths[1] * 0.45 && Math.abs(dy) >= minimumStrokeLengths[1] * 0.45 && inside(start) && inside(end) && isNearBoundary(start) && isNearBoundary(end) };
  };

  const firstDiagonal = diagonal(strokes[1]);
  if (!firstDiagonal.valid) {
    return makeCrossRecognition({ recognized: false, stage: "second-stroke", progress: 0.56, reason: "diagonal-hook", hint: "DRAW THE FIRST DIAGONAL CORNER TO CORNER" });
  }
  if (strokes.length === 2) {
    return makeCrossRecognition({ recognized: false, stage: "awaiting-next-stroke", progress: 0.67, reason: "stroke-count", hint: "LIFT, THEN DRAW THE SECOND DIAGONAL" });
  }

  const secondDiagonal = diagonal(strokes[2]);
  const firstDirection = Math.sign(firstDiagonal.dx * firstDiagonal.dy);
  const secondDirection = Math.sign(secondDiagonal.dx * secondDiagonal.dy);
  if (!secondDiagonal.valid || firstDirection === 0 || firstDirection === secondDirection) {
    return makeCrossRecognition({ recognized: false, stage: "second-stroke", progress: 0.84, reason: "diagonal-hook", hint: "CROSS THE SQUARE WITH THE OPPOSITE DIAGONAL" });
  }

  const totalLength = strokes.reduce((total, stroke) => total + runePathLength(stroke.points), 0);
  if (totalLength < minimumLength) {
    return makeCrossRecognition({ recognized: false, stage: "failed", progress: clampProgress(totalLength / minimumLength), reason: "too-short", hint: "DRAW A LARGER SQUARE AND CROSS" });
  }
  return makeCrossRecognition({ recognized: true, stage: "complete", progress: 1, hint: "AEGIS CROSS ACCEPTED" });
}

export function recognizeSquareCrossRune(strokes: RuneStroke[], arenaDimension: number) {
  return recognizeSquareCrossStrokes(strokes, arenaDimension);
}

/** Recognize a three-stroke zig-zag bolt, or the same bolt drawn continuously. */
export function recognizeLightningStrokes(strokes: RuneStroke[], arenaDimension: number): RuneRecognition {
  const dimension = Math.max(1, arenaDimension);
  const minimumLength = Math.max(150, dimension * 0.14);
  const minimumStrokeLengths = [Math.max(38, dimension * 0.07), Math.max(38, dimension * 0.07), Math.max(28, dimension * 0.05)];
  const makeLightningRecognition = (
    values: Pick<RuneRecognition, "recognized" | "stage" | "progress"> & { reason?: RuneFailureReason; hint?: string },
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
  const strokes = isStroke(first as RuneStrokeInput) ? (input as RuneStroke[]) : [{ points: input as RunePoint[] }];
  return recognizeLightningStrokes(strokes, arenaDimension);
}
