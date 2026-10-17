export type LightningBoltLayerRole = "glow" | "arc" | "core" | "spark";

export type LightningBoltLayer = {
  readonly id: string;
  readonly svgGroupId: string;
  readonly depth: number;
  readonly role: LightningBoltLayerRole;
};

export const LIGHTNING_BOLT_LAYERS = [
  { id: "glow", svgGroupId: "lightning-bolt-glow", depth: 0, role: "glow" },
  { id: "arcs", svgGroupId: "lightning-bolt-arcs", depth: 1, role: "arc" },
  { id: "bolt", svgGroupId: "lightning-bolt-shape", depth: 2, role: "arc" },
  { id: "core", svgGroupId: "lightning-bolt-core", depth: 3, role: "core" },
  { id: "sparks", svgGroupId: "lightning-bolt-sparks", depth: 4, role: "spark" },
] as const satisfies readonly LightningBoltLayer[];

export type LightningBoltLayerId = (typeof LIGHTNING_BOLT_LAYERS)[number]["id"];

export const LIGHTNING_BOLT_ASSET = {
  key: "lightning-bolt",
  url: "/assets/lightning-bolt.svg",
  width: 320,
  height: 128,
  origin: { x: 0.06, y: 0.5 },
  layers: LIGHTNING_BOLT_LAYERS,
} as const;

export function getLightningBoltLayer(id: LightningBoltLayerId) {
  return LIGHTNING_BOLT_LAYERS.find((layer) => layer.id === id);
}
