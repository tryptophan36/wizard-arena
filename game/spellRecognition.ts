import { SPELLS, type SpellData } from "@/game/spellData";
import { recognizeEmberLanceStrokes, recognizeLightningStrokes, recognizeSquareCrossStrokes, type RuneRecognition, type RuneStroke } from "@/game/runeGesture";

type SpellRecognizer = (strokes: RuneStroke[], arenaDimension: number) => RuneRecognition;

const RECOGNIZERS: Record<SpellData["gesture"]["recognizer"], SpellRecognizer> = {
  "ember-lance": recognizeEmberLanceStrokes,
  lightning: recognizeLightningStrokes,
  "square-cross": recognizeSquareCrossStrokes,
};

export type SpellRecognitionMatch = {
  spell: SpellData;
  recognition: RuneRecognition;
};

export function recognizeSpell(spell: SpellData, strokes: RuneStroke[], arenaDimension: number): RuneRecognition {
  return RECOGNIZERS[spell.gesture.recognizer](strokes, arenaDimension);
}

/** Try every registered spell so the drawn symbol, not the selected card, chooses the cast. */
export function recognizeAnySpell(strokes: RuneStroke[], arenaDimension: number): SpellRecognitionMatch {
  console.log("recognizeAnySpell", JSON.stringify(strokes, null, 2));
  const matches = SPELLS.map((spell) => ({ spell, recognition: recognizeSpell(spell, strokes, arenaDimension) }));
  console.log("matches", JSON.stringify(matches, null, 2));
  return matches.sort((left, right) => {
    if (left.recognition.recognized !== right.recognition.recognized) return left.recognition.recognized ? -1 : 1;
    if (left.recognition.progress !== right.recognition.progress) return right.recognition.progress - left.recognition.progress;
    return right.recognition.completedStrokes - left.recognition.completedStrokes;
  })[0];
}
