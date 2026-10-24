import {
  makeRecognition,
  type RuneRecognition,
  type RuneStroke,
} from "@/game/recognition/shared";

/** Recognize one closed, four-corner square for the Aegis ward. */
export function recognizeAegisStrokes(strokes: RuneStroke[], arenaDimension: number): RuneRecognition {
  void arenaDimension;
  const minimumLength = 0;
  const minimumStrokeLengths = [minimumLength];
  const makeAegisRecognition = (values: Parameters<typeof makeRecognition>[3]) =>
    makeRecognition(strokes, minimumLength, minimumStrokeLengths, values, undefined, undefined, 1);

  if (strokes.length === 0) {
    return makeAegisRecognition({ recognized: false, stage: "empty", progress: 0, reason: "too-short", hint: "START WITH ONE CLOSED SQUARE" });
  }
  if (strokes.length > 1) {
    return makeAegisRecognition({ recognized: false, stage: "failed", progress: 0.8, reason: "stroke-count", hint: "AEGIS USES ONE CLOSED SQUARE" });
  }

  const points = strokes[0].points;
  if (points.length < 5) {
    return makeAegisRecognition({ recognized: false, stage: "first-stroke", progress: 0, reason: "too-short", hint: "TRACE A CLOSED SQUARE" });
  }

  const start = points[0];
  const end = points[points.length - 1];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const width = maxX - minX; const height = maxY - minY;
  const closureDistance = Math.hypot(end.x - start.x, end.y - start.y);
  // Closure scales with the drawn square so there is no absolute size gate.
  const isClosed = closureDistance <= Math.max(Number.EPSILON, Math.max(width, height) * 0.28);
  let axisChanges = 0;
  let previousAxis = 0;
  let axisAlignmentTotal = 0;
  let axisAlignmentSamples = 0;
  let sharpTurns = 0;
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index].x - points[index - 1].x;
    const dy = points[index].y - points[index - 1].y;
    if (Math.hypot(dx, dy) <= Number.EPSILON) continue;
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
    if (incomingLength <= Number.EPSILON || outgoingLength <= Number.EPSILON) continue;
    const cosine = (incoming.x * outgoing.x + incoming.y * outgoing.y) / (incomingLength * outgoingLength);
    if (cosine < 0.45) sharpTurns += 1;
  }
  const aspectRatio = width / Math.max(height, Number.EPSILON);
  const startsOnPerimeter = start.x <= minX + width * 0.25 || start.x >= maxX - width * 0.25 || start.y <= minY + height * 0.25 || start.y >= maxY - height * 0.25;
  const averageAxisAlignment = axisAlignmentTotal / Math.max(axisAlignmentSamples, 1);
  const isSquareProportioned = aspectRatio >= 0.7 && aspectRatio <= 1.3;
  if (isClosed && startsOnPerimeter && axisChanges >= 3 && sharpTurns >= 2 && averageAxisAlignment >= 0.86 && isSquareProportioned) {
    return makeAegisRecognition({ recognized: true, stage: "complete", progress: 1, hint: "AEGIS SQUARE ACCEPTED" });
  }

  return makeAegisRecognition({ recognized: false, stage: "first-stroke", progress: 0.8, reason: !isClosed ? "stroke-position" : "diagonal-hook", hint: "CLOSE THE SQUARE WHERE YOU STARTED" });
}

export const recognizeAegisRune = recognizeAegisStrokes;

/** Compatibility names for callers that used the former square/cross recognizer. */
export const recognizeSquareStrokes = recognizeAegisStrokes;
export const recognizeSquareRune = recognizeAegisStrokes;
export const recognizeShieldStrokes = recognizeAegisStrokes;
export const recognizeSquareCrossStrokes = recognizeAegisStrokes;
export const recognizeSquareCrossRune = recognizeAegisStrokes;
