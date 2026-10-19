import { SPELLS, type SpellData } from "@/game/spellData";
import { recognizeAegisStrokes, recognizeEmberLanceStrokes, recognizeFreezeStrokes, recognizeGhostPortalStrokes, recognizeLightningStrokes } from "@/game/recognition";
import type { RuneRecognition, RuneStroke } from "@/game/runeGesture";

type SpellRecognizer = (strokes: RuneStroke[], arenaDimension: number) => RuneRecognition;

const RECOGNIZERS: Record<SpellData["gesture"]["recognizer"] | "square-cross", SpellRecognizer> = {
  "ember-lance": recognizeEmberLanceStrokes,
  lightning: recognizeLightningStrokes,
  aegis: recognizeAegisStrokes,
  freeze: recognizeFreezeStrokes,
  "ghost-portal": recognizeGhostPortalStrokes,
  // Accept the former data key while old spell records are still in circulation.
  "square-cross": recognizeAegisStrokes,
};

export type SpellRecognitionMatch = {
  spell: SpellData;
  recognition: RuneRecognition;
};

export function recognizeSpell(spell: SpellData, strokes: RuneStroke[], arenaDimension: number): RuneRecognition {
  return RECOGNIZERS[spell.gesture.recognizer](strokes, arenaDimension);
}

function isAwaitingNextStroke(recognition: RuneRecognition) {
  return recognition.stage === "awaiting-second-stroke" || recognition.stage === "awaiting-next-stroke";
}

/** Try every registered spell so the drawn symbol, not the selected card, chooses the cast. */
export function recognizeAnySpell(strokes: RuneStroke[], arenaDimension: number): SpellRecognitionMatch {
  const matches = SPELLS.map((spell) => ({ spell, recognition: recognizeSpell(spell, strokes, arenaDimension) }));
  return matches.sort((left, right) => {
    if (left.recognition.recognized !== right.recognition.recognized) return left.recognition.recognized ? -1 : 1;
    if (!left.recognition.recognized && isAwaitingNextStroke(left.recognition) !== isAwaitingNextStroke(right.recognition)) {
      return isAwaitingNextStroke(left.recognition) ? -1 : 1;
    }
    if (left.recognition.progress !== right.recognition.progress) return right.recognition.progress - left.recognition.progress;
    return right.recognition.completedStrokes - left.recognition.completedStrokes;
  })[0];
}
