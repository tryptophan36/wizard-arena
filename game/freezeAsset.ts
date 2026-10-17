export type FreezeLayerRole = "glow" | "ring" | "shell" | "core" | "spark";

export type FreezeLayer = {
  readonly id: string;
  readonly svgGroupId: string;
  readonly depth: number;
  readonly role: FreezeLayerRole;
};

export const FREEZE_LAYERS = [
  { id: "glow", svgGroupId: "freeze-glow", depth: 0, role: "glow" },
  { id: "outer-ring", svgGroupId: "freeze-outer-ring", depth: 1, role: "ring" },
  { id: "inner-ring", svgGroupId: "freeze-inner-ring", depth: 2, role: "ring" },
  { id: "ice-shell", svgGroupId: "freeze-ice-shell", depth: 3, role: "shell" },
  { id: "core", svgGroupId: "freeze-core", depth: 4, role: "core" },
  { id: "shards", svgGroupId: "freeze-shards", depth: 5, role: "spark" },
] as const satisfies readonly FreezeLayer[];

export type FreezeLayerId = (typeof FREEZE_LAYERS)[number]["id"];

export const FREEZE_ASSET = {
  key: "freeze",
  url: "/assets/freeze.svg",
  width: 320,
  height: 320,
  origin: { x: 0.5, y: 0.5 },
  layers: FREEZE_LAYERS,
} as const;

export function getFreezeLayer(id: FreezeLayerId) {
  return FREEZE_LAYERS.find((layer) => layer.id === id);
}
