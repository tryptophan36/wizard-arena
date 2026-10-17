export type RunePoint = { x: number; y: number };

export type RuneFailureReason = "too-short" | "downward-stroke" | "diagonal-hook";

export type RuneRecognition = {
  recognized: boolean;
  reason?: RuneFailureReason;
  pathLength: number;
  minimumLength: number;
};

export const EMBER_LANCE_RUNE_HINT = "DOWNWARD STROKE + UP-RIGHT HOOK";
const BASE_MINIMUM_LENGTH = 120;

function distance(a: RunePoint, b: RunePoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function runePathLength(points: RunePoint[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += distance(points[index - 1], points[index]);
  return length;
}

export function recognizeEmberLanceRune(points: RunePoint[], arenaDimension: number): RuneRecognition {
  const minimumLength = Math.max(BASE_MINIMUM_LENGTH, arenaDimension * 0.12);
  const pathLength = runePathLength(points);
  if (points.length < 4 || pathLength < minimumLength) return { recognized: false, reason: "too-short", pathLength, minimumLength };

  const start = points[0];
  let lowestIndex = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].y > points[lowestIndex].y) lowestIndex = index;
  }

  const lowest = points[lowestIndex];
  const downwardTravel = lowest.y - start.y;
  const sidewaysTravel = Math.abs(lowest.x - start.x);
  const minimumDrop = Math.max(45, arenaDimension * 0.1);
  if (lowestIndex < 2 || lowestIndex > points.length - 3 || downwardTravel < minimumDrop || sidewaysTravel > downwardTravel * 0.9) {
    return { recognized: false, reason: "downward-stroke", pathLength, minimumLength };
  }

  const end = points[points.length - 1];
  const hookDx = end.x - lowest.x;
  const hookDy = end.y - lowest.y;
  const hookLength = runePathLength(points.slice(lowestIndex));
  const minimumHook = Math.max(28, arenaDimension * 0.06);
  if (hookLength < minimumHook || hookDx < minimumHook * 0.75 || hookDy > -minimumHook * 0.35 || hookDx < Math.abs(hookDy) * 0.35) {
    return { recognized: false, reason: "diagonal-hook", pathLength, minimumLength };
  }

  return { recognized: true, pathLength, minimumLength };
}
