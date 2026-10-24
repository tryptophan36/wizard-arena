import {
  clampProgress,
  distance,
  makeRecognition,
  runeStrokePathLength,
  strokeEndTime,
  strokeStartTime,
  type RunePoint,
  type RuneRecognition,
  type RuneStroke,
} from "@/game/recognition/shared";

export const FREEZE_RUNE_HINT = "STROKE 1: OUTER CIRCLE · STROKE 2: INNER CIRCLE";

const FULL_TURN = Math.PI * 2;
const CIRCLE_HINT = "EACH STROKE MUST BE ONE CLOSED CIRCLE";

type CircleEstimate = {
  center: RunePoint;
  radius: number;
  pathLength: number;
  closureDistance: number;
  circularity: number;
  angularTravel: number;
  angularConsistency: number;
  sharpTurns: number;
};

function wrappedAngleDelta(delta: number) {
  return ((delta + Math.PI) % FULL_TURN + FULL_TURN) % FULL_TURN - Math.PI;
}

function estimateCircle(stroke: RuneStroke): CircleEstimate | null {
  const points = stroke.points;
  if (points.length < 2) return null;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const radii = points.map((point) => distance(center, point));
  const radius = radii.reduce((total, value) => total + value, 0) / radii.length;
  const radialVariance = radii.reduce((total, value) => total + (value - radius) ** 2, 0) / radii.length;
  const radialDeviation = Math.sqrt(radialVariance) / Math.max(radius, Number.EPSILON);
  const pathLength = runeStrokePathLength(stroke);
  let angularTravel = 0;
  let signedAngularTravel = 0;
  let sharpTurns = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previousAngle = Math.atan2(points[index - 1].y - center.y, points[index - 1].x - center.x);
    const currentAngle = Math.atan2(points[index].y - center.y, points[index].x - center.x);
    const delta = wrappedAngleDelta(currentAngle - previousAngle);
    angularTravel += Math.abs(delta);
    signedAngularTravel += delta;
  }
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incoming = { x: current.x - previous.x, y: current.y - previous.y };
    const outgoing = { x: next.x - current.x, y: next.y - current.y };
    const incomingLength = Math.hypot(incoming.x, incoming.y);
    const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
    if (incomingLength <= Number.EPSILON || outgoingLength <= Number.EPSILON) continue;
    const cosine = (incoming.x * outgoing.x + incoming.y * outgoing.y) / (incomingLength * outgoingLength);
    if (cosine < 0.45) sharpTurns += 1;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const aspectRatio = width / Math.max(height, Number.EPSILON);
  const aspectError = Math.abs(Math.log(Math.max(aspectRatio, Number.EPSILON)));
  return {
    center,
    radius,
    pathLength,
    closureDistance: distance(points[0], points[points.length - 1]),
    circularity: radialDeviation + aspectError,
    angularTravel,
    angularConsistency: Math.abs(signedAngularTravel) / Math.max(angularTravel, Number.EPSILON),
    sharpTurns,
  };
}

function isCircle(estimate: CircleEstimate) {
  const closureTolerance = Math.max(Number.EPSILON, estimate.radius * 0.45);
  const circumferenceRatio = estimate.pathLength / Math.max(FULL_TURN * estimate.radius, Number.EPSILON);
  return (
    estimate.sharpTurns <= 1 &&
    estimate.closureDistance <= closureTolerance &&
    estimate.circularity <= 0.34 &&
    circumferenceRatio >= 0.68 &&
    circumferenceRatio <= 1.38 &&
    estimate.angularTravel >= FULL_TURN * 0.72 &&
    estimate.angularTravel <= FULL_TURN * 1.42 &&
    estimate.angularConsistency >= 0.72
  );
}

function makeFreezeRecognition(
  strokes: RuneStroke[],
  minimumLength: number,
  minimumStrokeLengths: number[],
  values: Parameters<typeof makeRecognition>[3],
  pauseMs?: number,
  gapDistance?: number,
) {
  return makeRecognition(strokes, minimumLength, minimumStrokeLengths, values, pauseMs, gapDistance, 2);
}

/** Recognize exactly two nearby, closed circular strokes with a shared center. */
export function recognizeFreezeStrokes(strokes: RuneStroke[], arenaDimension: number): RuneRecognition {
  void arenaDimension;
  const minimumLength = 0;
  const minimumStrokeLengths = [0, 0];


  if (strokes.length === 0) {
    return makeFreezeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "empty",
      progress: 0,
      reason: "too-short",
      hint: FREEZE_RUNE_HINT,
    });
  }

  if (strokes.length > 2) {
    return makeFreezeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: 0.9,
      reason: "stroke-count",
      hint: "FREEZE USES EXACTLY TWO CIRCLES",
    });
  }

  const circles: CircleEstimate[] = [];
  for (let index = 0; index < strokes.length; index += 1) {
    const stroke = strokes[index];
    const circle = estimateCircle(stroke);
    if (!circle || !isCircle(circle)) {
      return makeFreezeRecognition(strokes, minimumLength, minimumStrokeLengths, {
        recognized: false,
        stage: index === 0 ? "first-stroke" : "second-stroke",
        progress: clampProgress(index / 2 + 0.18),
        reason: "circle-shape",
        hint: CIRCLE_HINT,
      });
    }

    if (index > 0) {
      const previous = strokes[index - 1];
      const previousEnd = previous.points[previous.points.length - 1];
      const currentStart = stroke.points[0];
      const gapDistance = distance(previousEnd, currentStart);
      const previousEndTime = strokeEndTime(previous);
      const currentStartTime = strokeStartTime(stroke);
      const pauseMs = previousEndTime !== undefined && currentStartTime !== undefined ? currentStartTime - previousEndTime : undefined;
      const positionTolerance = Math.max(Number.EPSILON, circles[0].radius * 1.35);
      if (pauseMs !== undefined && pauseMs < 0) {
        return makeFreezeRecognition(strokes, minimumLength, minimumStrokeLengths, {
          recognized: false,
          stage: "failed",
          progress: index / 2,
          reason: "stroke-order",
          hint: "FINISH EACH CIRCLE IN ORDER",
        }, pauseMs, gapDistance);
      }
      if (gapDistance > positionTolerance) {
        return makeFreezeRecognition(strokes, minimumLength, minimumStrokeLengths, {
          recognized: false,
          stage: "failed",
          progress: index / 2,
          reason: "stroke-position",
          hint: "START EACH CIRCLE NEAR THE LAST RING",
        }, pauseMs, gapDistance);
      }
    }
    circles.push(circle);
  }

  if (circles.length < 2) {
    return makeFreezeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "awaiting-next-stroke",
      progress: circles.length / 2,
      reason: "stroke-count",
      hint: "ADD THE INNER CLOSED CIRCLE",
    });
  }

  const reference = circles[0];
  const centerTolerance = Math.max(Number.EPSILON, Math.max(...circles.map((circle) => circle.radius)) * 0.55);
  const centersAreConcentric = circles.every((circle) => distance(reference.center, circle.center) <= centerTolerance);
  const radii = circles.map((circle) => circle.radius);
  const radiiAreDistinct = radii.every((radius, index) =>
    radii.every((other, otherIndex) => index === otherIndex || Math.abs(radius - other) >= Math.max(Number.EPSILON, Math.min(radius, other) * 0.18)),
  );
  if (!centersAreConcentric || !radiiAreDistinct) {
    return makeFreezeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: 0.86,
      reason: "stroke-position",
      hint: !centersAreConcentric ? "KEEP BOTH CIRCLES CONCENTRIC" : "USE TWO DISTINCT RING SIZES",
    });
  }

  return makeFreezeRecognition(strokes, minimumLength, minimumStrokeLengths, {
    recognized: true,
    stage: "complete",
    progress: 1,
    hint: "TWO CONCENTRIC CIRCLES ACCEPTED",
  });
}

export function recognizeFreezeRune(strokes: RuneStroke[], arenaDimension: number): RuneRecognition;
export function recognizeFreezeRune(points: RunePoint[], arenaDimension: number): RuneRecognition;
export function recognizeFreezeRune(input: RuneStroke[] | RunePoint[], arenaDimension: number): RuneRecognition {
  if (input.length === 0) return recognizeFreezeStrokes([], arenaDimension);
  const first = input[0];
  const strokes = "points" in first ? (input as RuneStroke[]) : [{ points: input as RunePoint[] }];
  return recognizeFreezeStrokes(strokes, arenaDimension);
}

export const recognizeFreezeMultiStroke = recognizeFreezeStrokes;
export const recognizeFreeze = recognizeFreezeStrokes;
