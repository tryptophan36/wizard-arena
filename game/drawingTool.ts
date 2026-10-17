import type { RunePoint } from "@/game/recognition/shared";

export type DrawingTool = "freehand" | "circle" | "square" | "line";
export type DrawingToolState = { value: DrawingTool };

export const DEFAULT_DRAWING_TOOL: DrawingTool = "freehand";

const CIRCLE_SEGMENTS = 32;

type Bounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

function getBounds(points: RunePoint[]): Bounds {
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: points[0].x, maxX: points[0].x, minY: points[0].y, maxY: points[0].y },
  );
}

function interpolatedTimestamp(points: RunePoint[], progress: number) {
  const start = points[0]?.timestamp;
  const end = points[points.length - 1]?.timestamp;

  if (start === undefined || end === undefined) return undefined;
  return start + (end - start) * progress;
}

function makePoint(x: number, y: number, timestamp: number | undefined): RunePoint {
  return timestamp === undefined ? { x, y } : { x, y, timestamp };
}

/** Convert a raw pointer stroke into its start and end points. */
export function normalizeLine(points: RunePoint[]): RunePoint[] {
  if (points.length <= 2) return points;

  return [points[0], points[points.length - 1]];
}

/** Convert a raw pointer stroke into a closed, axis-aligned square. */
export function normalizeSquare(points: RunePoint[]): RunePoint[] {
  if (points.length < 2) return points;

  const { minX, maxX, minY, maxY } = getBounds(points);
  const size = Math.max(maxX - minX, maxY - minY);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const left = centerX - size / 2;
  const right = centerX + size / 2;
  const top = centerY - size / 2;
  const bottom = centerY + size / 2;
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
    { x: left, y: top },
  ];

  return corners.map((corner, index) =>
    makePoint(corner.x, corner.y, interpolatedTimestamp(points, index / (corners.length - 1))),
  );
}

/** Convert a raw pointer stroke into a closed circle around its bounding box. */
export function normalizeCircle(points: RunePoint[]): RunePoint[] {
  if (points.length < 2) return points;

  const { minX, maxX, minY, maxY } = getBounds(points);
  const radius = Math.max(maxX - minX, maxY - minY) / 2;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const normalizedPoints: RunePoint[] = [];

  for (let index = 0; index <= CIRCLE_SEGMENTS; index += 1) {
    const progress = index / CIRCLE_SEGMENTS;
    const angle = progress * Math.PI * 2;
    normalizedPoints.push(
      makePoint(
        centerX + Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius,
        interpolatedTimestamp(points, progress),
      ),
    );
  }

  return normalizedPoints;
}

/** Normalize a stroke according to the selected drawing tool. */
export function normalizeStroke(points: RunePoint[], tool: DrawingTool = DEFAULT_DRAWING_TOOL): RunePoint[] {
  switch (tool) {
    case "freehand":
      return points;
    case "line":
      return normalizeLine(points);
    case "square":
      return normalizeSquare(points);
    case "circle":
      return normalizeCircle(points);
  }
}

/** Alias that makes the dispatcher name explicit at call sites. */
export const normalizeDrawingStroke = normalizeStroke;
