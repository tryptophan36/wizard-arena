import {
  clampProgress,
  distance,
  makeRecognition,
  runePathLength,
  runeStrokePathLength,
  strokeEndTime,
  strokeStartTime,
  type RunePoint,
  type RuneRecognition,
  type RuneStroke,
} from "@/game/recognition/shared";

/**
 * Recognize the ordered, mouse-lift version of Ember Lance.
 *
 * Stroke one is a long, mostly vertical downward line. Stroke two must begin
 * close to stroke one's endpoint and travel up and right as a diagonal hook.
 * Timing is optional and is only used to validate stroke ordering.
 */
export function recognizeEmberLanceStrokes(strokes: RuneStroke[], arenaDimension: number): RuneRecognition {
  const dimension = Math.max(1, arenaDimension);
  const minimumLength = Math.max(120, dimension * 0.12);
  const minimumFirstLength = Math.max(55, dimension * 0.1);
  const minimumHookLength = Math.max(28, dimension * 0.055);
  const minimumStrokeLengths: [number, number] = [minimumFirstLength, minimumHookLength];

  if (strokes.length === 0) {
    return makeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "empty",
      progress: 0,
      reason: "too-short",
      hint: "START WITH A LONG DOWNWARD STROKE",
    });
  }

  if (strokes.length > 2) {
    return makeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: 0.9,
      reason: "stroke-count",
      hint: "EMBER LANCE USES EXACTLY TWO STROKES",
    });
  }

  const first = strokes[0];
  const firstLength = runeStrokePathLength(first);

  // Ember Lance is forgiving about the mouse lift: a player may draw the
  // simple rune continuously, or pause at the turn and continue as stroke 2.
  // Check the continuous form before treating a single stroke as an incomplete
  // first line.
  if (strokes.length === 1 && first.points.length >= 4 && firstLength >= minimumLength) {
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
      return makeRecognition(strokes, minimumLength, minimumStrokeLengths, {
        recognized: true,
        stage: "complete",
        progress: 1,
        hint: "CONTINUOUS RUNE ACCEPTED",
      });
    }
  }

  if (first.points.length < 2 || firstLength < minimumFirstLength) {
    return makeRecognition(strokes, minimumLength, minimumStrokeLengths, {
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
    return makeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: 0.35,
      reason: "downward-stroke",
      hint: "START WITH A STRAIGHT, LONG DOWNWARD STROKE",
    });
  }

  if (strokes.length === 1) {
    return makeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "awaiting-second-stroke",
      progress: 0.5,
      reason: "stroke-count",
      hint: "LIFT, THEN ADD THE UP-RIGHT HOOK",
    });
  }

  const second = strokes[1];
  const secondLength = runeStrokePathLength(second);
  if (second.points.length < 2 || secondLength < minimumHookLength) {
    return makeRecognition(strokes, minimumLength, minimumStrokeLengths, {
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
    return makeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: 0.5,
      reason: "stroke-order",
      hint: "FINISH THE DOWNWARD STROKE BEFORE STARTING THE HOOK",
    }, pauseMs, gapDistance);
  }

  if (gapDistance > positionTolerance) {
    return makeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: 0.55,
      reason: "stroke-position",
      hint: "START THE UP-RIGHT HOOK NEAR THE END OF STROKE 1",
    }, pauseMs, gapDistance);
  }

  const hookDx = secondEnd.x - secondStart.x;
  const hookRise = secondStart.y - secondEnd.y;
  const hookStraightness = distance(secondStart, secondEnd) / Math.max(secondLength, 1);
  if (
    hookDx < minimumHookLength * 0.6 ||
    hookRise < minimumHookLength * 0.25 ||
    hookDx < hookRise * 0.45 ||
    hookStraightness < 0.58
  ) {
    return makeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "second-stroke",
      progress: 0.72,
      reason: "diagonal-hook",
      hint: "FINISH WITH AN UP-RIGHT DIAGONAL HOOK",
    }, pauseMs, gapDistance);
  }

  const totalLength = firstLength + secondLength;
  if (totalLength < minimumLength) {
    return makeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: clampProgress(totalLength / minimumLength),
      reason: "too-short",
      hint: "DRAW A LONGER EMBER LANCE RUNE",
    }, pauseMs, gapDistance);
  }

  return makeRecognition(strokes, minimumLength, minimumStrokeLengths, {
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
  const strokes = "points" in first ? (input as RuneStroke[]) : [{ points: input as RunePoint[] }];
  return recognizeEmberLanceStrokes(strokes, arenaDimension);
}

/** Explicit name for callers that want to make the mouse-lift contract clear. */
export const recognizeEmberLanceMultiStroke = recognizeEmberLanceStrokes;
