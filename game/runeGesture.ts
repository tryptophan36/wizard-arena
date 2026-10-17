/**
 * Compatibility barrel for the original gesture module.
 * Spell implementations live in game/recognition/<spell>.ts.
 */
export {
  recognizeEmberLanceMultiStroke,
  recognizeEmberLanceRune,
  recognizeEmberLanceStrokes,
} from "@/game/recognition/emberLance";
export {
  recognizeAegisRune,
  recognizeAegisStrokes,
  recognizeShieldStrokes,
  recognizeSquareCrossRune,
  recognizeSquareCrossStrokes,
  recognizeSquareRune,
  recognizeSquareStrokes,
} from "@/game/recognition/aegis";
export {
  LIGHTNING_RUNE_HINT,
  recognizeLightningRune,
  recognizeLightningStrokes,
} from "@/game/recognition/lightning";
export {
  runePathLength,
  runeStrokePathLength,
  EMBER_LANCE_RUNE_HINT,
  type RuneFailureReason,
  type RunePoint,
  type RuneRecognition,
  type RuneRecognitionStage,
  type RuneStroke,
  type RuneStrokeInput,
} from "@/game/recognition/shared";
