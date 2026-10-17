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
  const radialDeviation = Math.sqrt(radialVariance) / Math.max(radius, 1);
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
    if (incomingLength < 3 || outgoingLength < 3) continue;
    const cosine = (incoming.x * outgoing.x + incoming.y * outgoing.y) / (incomingLength * outgoingLength);
    if (cosine < 0.45) sharpTurns += 1;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const aspectRatio = width / Math.max(height, 1);
  const aspectError = Math.abs(Math.log(Math.max(aspectRatio, 0.001)));
  return {
    center,
    radius,
    pathLength,
    closureDistance: distance(points[0], points[points.length - 1]),
    circularity: radialDeviation + aspectError,
    angularTravel,
    angularConsistency: Math.abs(signedAngularTravel) / Math.max(angularTravel, 1),
    sharpTurns,
  };
}

function isCircle(estimate: CircleEstimate, dimension: number, minimumLength: number) {
  const minimumRadius = Math.max(16, dimension * 0.035);
  const closureTolerance = Math.max(14, dimension * 0.035);
  const circumferenceRatio = estimate.pathLength / Math.max(FULL_TURN * estimate.radius, 1);
  return (
    estimate.sharpTurns <= 1 &&
    estimate.radius >= minimumRadius &&
    estimate.pathLength >= Math.min(minimumLength, Math.max(58, dimension * 0.055)) &&
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
  const dimension = Math.max(1, arenaDimension);
  const minimumLength = Math.max(180, dimension * 0.2);
  const minimumStrokeLength = Math.max(58, dimension * 0.055);
  const minimumStrokeLengths = [minimumStrokeLength, minimumStrokeLength];
  const positionTolerance = Math.max(36, dimension * 0.1);
  const centerTolerance = Math.max(24, dimension * 0.065);

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
    if (!circle || !isCircle(circle, dimension, minimumLength)) {
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
      if (pauseMs !== undefined && (pauseMs < 0 || pauseMs > MAX_STROKE_PAUSE_MS)) {
        return makeFreezeRecognition(strokes, minimumLength, minimumStrokeLengths, {
          recognized: false,
          stage: "failed",
          progress: index / 2,
          reason: pauseMs < 0 ? "stroke-order" : "pause-too-long",
          hint: pauseMs < 0 ? "FINISH EACH CIRCLE IN ORDER" : "KEEP THE PAUSE BETWEEN CIRCLES SHORT",
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
  const centersAreConcentric = circles.every((circle) => distance(reference.center, circle.center) <= centerTolerance);
  const radii = circles.map((circle) => circle.radius);
  const radiiAreDistinct = radii.every((radius, index) => radii.every((other, otherIndex) => index === otherIndex || Math.abs(radius - other) >= Math.max(8, dimension * 0.015)));
  if (!centersAreConcentric || !radiiAreDistinct) {
    return makeFreezeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: 0.86,
      reason: "stroke-position",
      hint: !centersAreConcentric ? "KEEP BOTH CIRCLES CONCENTRIC" : "USE TWO DISTINCT RING SIZES",
    });
  }

  const totalLength = circles.reduce((total, circle) => total + circle.pathLength, 0);
  if (totalLength < minimumLength) {
    return makeFreezeRecognition(strokes, minimumLength, minimumStrokeLengths, {
      recognized: false,
      stage: "failed",
      progress: clampProgress(totalLength / minimumLength),
      reason: "too-short",
      hint: "DRAW TWO LARGER FROST CIRCLES",
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
