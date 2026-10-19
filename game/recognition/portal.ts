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

export const GHOST_PORTAL_RUNE_HINT = "STROKE 1: CIRCLE · STROKE 2: SEPARATE CIRCLE · STROKE 3: SEPARATE CIRCLE";

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
  return {
    center,
    radius,
    pathLength,
    closureDistance: distance(points[0], points[points.length - 1]),
    circularity: radialDeviation + Math.abs(Math.log(Math.max(width / Math.max(height, 1), 0.001))),
    angularTravel,
    angularConsistency: Math.abs(signedAngularTravel) / Math.max(angularTravel, 1),
    sharpTurns,
  };
}

function isCircle(estimate: CircleEstimate, dimension: number) {
  const closureTolerance = Math.max(14, dimension * 0.035);
  const circumferenceRatio = estimate.pathLength / Math.max(FULL_TURN * estimate.radius, 1);
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

/** Recognize exactly three separate, closed circular strokes. */
export function recognizeGhostPortalStrokes(strokes: RuneStroke[], arenaDimension: number): RuneRecognition {
  const dimension = Math.max(1, arenaDimension);
  const expectedStrokes = 3;
  const minimumLength = 0;
  const minimumStrokeLengths = Array.from({ length: expectedStrokes }, () => 0);
  const makePortalRecognition = (
    values: Parameters<typeof makeRecognition>[3],
    pauseMs?: number,
    gapDistance?: number,
  ) => makeRecognition(strokes, minimumLength, minimumStrokeLengths, values, pauseMs, gapDistance, expectedStrokes);

  if (strokes.length === 0) {
    return makePortalRecognition({ recognized: false, stage: "empty", progress: 0, reason: "too-short", hint: GHOST_PORTAL_RUNE_HINT });
  }
  if (strokes.length > expectedStrokes) {
    return makePortalRecognition({ recognized: false, stage: "failed", progress: 0.9, reason: "stroke-count", hint: "GHOST PORTAL USES EXACTLY THREE CIRCLES" });
  }

  const circles: CircleEstimate[] = [];
  for (let index = 0; index < strokes.length; index += 1) {
    const stroke = strokes[index];
    const circle = estimateCircle(stroke);
    if (!circle || !isCircle(circle, dimension)) {
      return makePortalRecognition({
        recognized: false,
        stage: index === 0 ? "first-stroke" : "second-stroke",
        progress: clampProgress(index / expectedStrokes + 0.18),
        reason: "circle-shape",
        hint: CIRCLE_HINT,
      });
    }

    if (index > 0) {
      const previous = strokes[index - 1];
      const pauseMs = strokeStartTime(stroke) !== undefined && strokeEndTime(previous) !== undefined
        ? strokeStartTime(stroke)! - strokeEndTime(previous)!
        : undefined;
      if (pauseMs !== undefined && pauseMs < 0) {
        return makePortalRecognition({ recognized: false, stage: "failed", progress: index / expectedStrokes, reason: "stroke-order", hint: "FINISH EACH CIRCLE IN ORDER" }, pauseMs);
      }
    }
    circles.push(circle);
  }

  if (circles.length < expectedStrokes) {
    return makePortalRecognition({ recognized: false, stage: "awaiting-next-stroke", progress: circles.length / expectedStrokes, reason: "stroke-count", hint: `ADD SEPARATE CIRCLE ${circles.length + 1}` });
  }

  const circlesAreSeparate = circles.every((circle, index) => circles.every((other, otherIndex) => {
    if (index === otherIndex) return true;
    const requiredSeparation = (circle.radius + other.radius) * 0.8;
    return distance(circle.center, other.center) >= requiredSeparation;
  }));
  if (!circlesAreSeparate) {
    return makePortalRecognition({ recognized: false, stage: "failed", progress: 0.86, reason: "stroke-position", hint: "KEEP THE THREE CIRCLES SEPARATE" });
  }

  return makePortalRecognition({ recognized: true, stage: "complete", progress: 1, hint: "THREE SEPARATE CIRCLES ACCEPTED" });
}
