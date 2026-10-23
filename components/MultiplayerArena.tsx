"use client";

import { useCallback, useMemo, useState } from "react";

import MultiplayerPhaserArena from "@/components/MultiplayerPhaserArena";
import type { MultiplayerArenaFeedback } from "@/game/MultiplayerArenaScene";
import { DEFAULT_DRAWING_TOOL, type DrawingTool } from "@/game/drawingTool";
import type {
  DuelClient,
  DuelConnectionState,
  DuelPlayerSnapshot,
  DuelStateSnapshot,
} from "@/lib/multiplayer";

type MultiplayerArenaProps = {
  client: DuelClient;
  roomState: DuelStateSnapshot;
  sessionId: string | null;
  connectionState: DuelConnectionState;
  leaving: boolean;
  onLeave: () => void;
};

const CONNECTION_LABELS: Record<DuelConnectionState, string> = {
  connecting: "CONNECTING",
  connected: "CONNECTED",
  reconnecting: "RECONNECTING",
  disconnected: "DISCONNECTED",
};

const DEFAULT_FEEDBACK: MultiplayerArenaFeedback = {
  status: "idle",
  message: "DRAW RUNE",
  hint: "TRACE A REGISTERED SYMBOL · PRESS A TO MATCH",
};

const DRAWING_TOOLS: readonly { id: DrawingTool; label: string; icon: string }[] = [
  { id: "freehand", label: "FREEHAND", icon: "∿" },
  { id: "circle", label: "CIRCLE", icon: "○" },
  { id: "square", label: "SQUARE", icon: "□" },
  { id: "line", label: "LINE", icon: "╱" },
];

export default function MultiplayerArena({
  client,
  roomState,
  sessionId,
  connectionState,
  leaving,
  onLeave,
}: MultiplayerArenaProps) {
  const [feedback, setFeedback] = useState<MultiplayerArenaFeedback>(DEFAULT_FEEDBACK);
  const [drawingTool, setDrawingTool] = useState<DrawingTool>(DEFAULT_DRAWING_TOOL);
  const onFeedback = useCallback((nextFeedback: MultiplayerArenaFeedback) => {
    setFeedback(nextFeedback);
  }, []);
  const currentPlayer = sessionId ? roomState.players.get(sessionId) ?? null : null;
  const opponent = useMemo(
    () => Array.from(roomState.players.values()).find((player) => player.sessionId !== sessionId) ?? null,
    [roomState.players, sessionId],
  );
  const phaseLabel = currentPlayer ? formatSpellPhase(currentPlayer.activeSpellPhase) : "SYNCING STATE";
  const isWinner = Boolean(sessionId && roomState.winnerSessionId === sessionId);
  const isFinished = roomState.phase === "finished";

  return (
    <section className="multiplayer-arena" aria-label="Multiplayer arena">
      <div className="multiplayer-arena-topbar">
        <div className="multiplayer-arena-channel">
          <span className={`status-dot multiplayer-arena-connection-dot is-${connectionState}`} />
          <span>DUEL CHANNEL / {CONNECTION_LABELS[connectionState]}</span>
          <i />
          <span>ROOM {roomState.roomId}</span>
        </div>
        <button className="multiplayer-arena-leave" type="button" disabled={leaving} onClick={onLeave}>
          {leaving ? "LEAVING..." : "LEAVE DUEL"} <span aria-hidden="true">↗</span>
        </button>
      </div>

      <MultiplayerPhaserArena client={client} onFeedback={onFeedback} drawingTool={drawingTool} />
      <div className="multiplayer-arena-vignette" aria-hidden="true" />

      <nav className="drawing-toolbar" aria-label="Rune drawing tool">
        <span className="drawing-toolbar-label">DRAWING TOOL</span>
        <div className="drawing-tool-list">
          {DRAWING_TOOLS.map((tool) => (
            <button
              className="drawing-tool"
              type="button"
              key={tool.id}
              aria-pressed={drawingTool === tool.id}
              onClick={() => setDrawingTool(tool.id)}
              title={`Use ${tool.label.toLowerCase()} tool`}
            >
              <span className="drawing-tool-icon" aria-hidden="true">{tool.icon}</span>
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <div className="multiplayer-arena-hud multiplayer-arena-hud-top">
        <ArenaPlayerCard label="YOUR SIGIL" player={currentPlayer} isCurrent />
        <div className="multiplayer-arena-round-status">
          <span className={`multiplayer-arena-feedback multiplayer-arena-feedback-${feedback.status}`} role="status" aria-live="polite">
            <strong>{feedback.message}</strong>
            <small>{feedback.hint}</small>
          </span>
          <span className="multiplayer-arena-phase">{phaseLabel}</span>
        </div>
        <ArenaPlayerCard label="OPPONENT SIGIL" player={opponent} />
      </div>

      <div className="multiplayer-arena-controls">
        <span className="multiplayer-arena-control-key">MOUSE</span>
        <span>DRAW RUNE</span>
        <i />
        <span className="multiplayer-arena-control-key">A</span>
        <span>MATCH SPELL</span>
      </div>

      {isFinished && (
        <section className={`multiplayer-arena-result${isWinner ? " is-victory" : " is-defeat"}`} role="status">
          <p className="eyebrow">DUEL COMPLETE</p>
          <h2>{isWinner ? "CIRCUIT VICTORY" : "RUNE SILENCED"}</h2>
          <p>{isWinner ? "Your spellwork held the arena." : "The opposing wizard claimed the arena."}</p>
          <div className="multiplayer-arena-result-meta">
            <span>FINAL VITALITY</span>
            <strong>{currentPlayer?.health ?? 0} / {opponent?.health ?? 0}</strong>
          </div>
        </section>
      )}
    </section>
  );
}

function ArenaPlayerCard({
  label,
  player,
  isCurrent = false,
}: {
  label: string;
  player: DuelPlayerSnapshot | null;
  isCurrent?: boolean;
}) {
  const health = player?.health ?? 0;
  const mana = player?.mana ?? 0;
  return (
    <section className={`multiplayer-arena-player-card${isCurrent ? " is-current" : ""}`}>
      <div className="multiplayer-arena-player-heading">
        <span className="multiplayer-arena-player-mark">{isCurrent ? "✧" : "◇"}</span>
        <div>
          <p className="eyebrow">{label}</p>
          <h3>{player?.displayName ?? "AWAITING WIZARD"}</h3>
          <small>{player?.wizardId ? `${player.wizardId.toUpperCase()} ASPECT` : "STATE SYNCING"}</small>
        </div>
      </div>
      <div className="multiplayer-arena-resource">
        <div><span>VITALITY</span><strong>{health} / 100</strong></div>
        <div className="multiplayer-arena-bar"><span className="is-health" style={{ width: `${percentage(health)}%` }} /></div>
      </div>
      <div className="multiplayer-arena-resource">
        <div><span>MANA</span><strong>{mana} / 100</strong></div>
        <div className="multiplayer-arena-bar"><span className="is-mana" style={{ width: `${percentage(mana)}%` }} /></div>
      </div>
      {player && (player.shield || player.frozen || player.stunned) && (
        <div className="multiplayer-arena-status-tags">
          {player.shield && <span>AEGIS</span>}
          {player.frozen && <span>FROZEN</span>}
          {player.stunned && <span>STUNNED</span>}
        </div>
      )}
    </section>
  );
}

function percentage(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function formatSpellPhase(phase: DuelPlayerSnapshot["activeSpellPhase"]): string {
  switch (phase) {
    case "charging": return "WEAVING SPELL";
    case "flying": return "SPELL IN FLIGHT";
    case "impact": return "DIRECT IMPACT";
    default: return "READY TO DRAW";
  }
}
