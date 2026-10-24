import assert from "node:assert/strict";
import test from "node:test";

import { normalizeCircle, normalizeSquare } from "@/game/drawingTool";
import { recognizeAegisStrokes } from "@/game/recognition/aegis";
import { recognizeFreezeStrokes } from "@/game/recognition/freeze";
import { recognizeLightningStrokes } from "@/game/recognition/lightning";
import { recognizeEmberLanceStrokes } from "@/game/recognition/emberLance";
import { recognizeGhostPortalStrokes } from "@/game/recognition/portal";
import type { RunePoint, RuneStroke } from "@/game/recognition/shared";

function pointsForCircle(centerX: number, centerY: number, radius: number): RunePoint[] {
  return normalizeCircle([
    { x: centerX - radius, y: centerY },
    { x: centerX + radius, y: centerY },
  ]);
}

function stroke(points: RunePoint[]): RuneStroke {
  return { points };
}

function line(startX: number, startY: number, endX: number, endY: number): RuneStroke {
  return stroke([{ x: startX, y: startY }, { x: endX, y: endY }]);
}

test("accepts a tiny square for Aegis", () => {
  const points = normalizeSquare([
    { x: 100, y: 100 },
    { x: 100.25, y: 100.2 },
  ]);

  assert.equal(recognizeAegisStrokes([stroke(points)], 1000).recognized, true);
});

test("accepts tiny concentric circles for Freeze", () => {
  const outer = pointsForCircle(200, 200, 0.8);
  const inner = pointsForCircle(200, 200, 0.5);

  assert.equal(recognizeFreezeStrokes([stroke(outer), stroke(inner)], 1000).recognized, true);
});

test("accepts tiny separate circles for Ghost Portal", () => {
  const circles = [
    pointsForCircle(300, 300, 0.5),
    pointsForCircle(302, 300, 0.5),
    pointsForCircle(304, 300, 0.5),
  ].map(stroke);

  assert.equal(recognizeGhostPortalStrokes(circles, 1000).recognized, true);
});

test("accepts tiny directional strokes for Ember Lance and Lightning", () => {
  const ember = recognizeEmberLanceStrokes([
    line(100, 100, 100.5, 101),
    line(100.5, 101, 101.5, 100.5),
  ], 1000);
  const lightning = recognizeLightningStrokes([
    line(200, 200, 200.5, 201),
    line(200.5, 201, 200.1, 201.5),
    line(200.1, 201.5, 200.6, 202),
  ], 1000);

  assert.equal(ember.recognized, true);
  assert.equal(lightning.recognized, true);
});
