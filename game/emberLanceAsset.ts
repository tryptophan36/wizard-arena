export type EmberLanceLayerRole = "glow" | "flame" | "core" | "spark";

export type EmberLanceLayer = {
  readonly id: string;
  readonly svgGroupId: string;
  readonly depth: number;
  readonly role: EmberLanceLayerRole;
};

export const EMBER_LANCE_LAYERS = [
  { id: "glow", svgGroupId: "ember-lance-glow", depth: 0, role: "glow" },
  { id: "flame-tail", svgGroupId: "ember-lance-flame-tail", depth: 1, role: "flame" },
  { id: "silhouette", svgGroupId: "ember-lance-silhouette", depth: 2, role: "flame" },
  { id: "hot-core", svgGroupId: "ember-lance-hot-core", depth: 3, role: "core" },
  { id: "sparks", svgGroupId: "ember-lance-sparks", depth: 4, role: "spark" },
] as const satisfies readonly EmberLanceLayer[];

export type EmberLanceLayerId = (typeof EMBER_LANCE_LAYERS)[number]["id"];

export const EMBER_LANCE_ASSET = {
  key: "ember-lance",
  url: "/assets/ember-lance.svg",
  width: 320,
  height: 128,
  origin: { x: 0.06, y: 0.5 },
  layers: EMBER_LANCE_LAYERS,
} as const;

export function getEmberLanceLayer(id: EmberLanceLayerId) {
  return EMBER_LANCE_LAYERS.find((layer) => layer.id === id);
}
