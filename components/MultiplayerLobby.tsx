"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import {
  DuelClient,
  type DuelConnectionState,
  type DuelStateSnapshot,
} from "@/lib/multiplayer";

const WIZARD_OPTIONS = [
  { id: "ember", label: "EMBER ASPECT", detail: "HEAT / FORCE" },
  { id: "frost", label: "FROST ASPECT", detail: "CONTROL / FOCUS" },
  { id: "aegis", label: "AEGIS ASPECT", detail: "WARD / RESOLVE" },
] as const;

type LobbyAction = "create" | "join" | "ready" | "leave" | null;
type CopyState = "idle" | "copied" | "error";

const CONNECTION_LABELS: Record<DuelConnectionState, string> = {
  connecting: "CONNECTING",
  connected: "CONNECTED",
  reconnecting: "RECONNECTING",
  disconnected: "DISCONNECTED",
};

const PHASE_COPY: Record<
  DuelStateSnapshot["phase"],
  { label: string; title: string; description: string }
> = {
  waiting: {
    label: "WAITING",
    title: "WAITING FOR OPPONENT",
    description: "Share the room ID with another wizard. The duel opens when they join.",
  },
  ready: {
    label: "READY CHECK",
    title: "BOTH WIZARDS CONNECTED",
    description: "Confirm your ready state. The duel begins when both players are ready.",
  },
  playing: {
    label: "PLAYING",
    title: "DUEL CHANNEL OPEN",
    description: "Both wizards are ready. The arena match surface will appear here next.",
  },
  finished: {
    label: "FINISHED",
    title: "MATCH COMPLETE",
    description: "This room is closed. Return to the menu to start another network duel.",
  },
};

export default function MultiplayerLobby() {
  const router = useRouter();
  const clientRef = useRef<DuelClient | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [wizardId, setWizardId] = useState<string>(WIZARD_OPTIONS[0].id);
  const [roomIdInput, setRoomIdInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [roomState, setRoomState] = useState<DuelStateSnapshot | null>(null);
  const [connectionState, setConnectionState] = useState<DuelConnectionState>("disconnected");
  const [action, setAction] = useState<LobbyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");

  useEffect(() => {
    const client = new DuelClient({ url: process.env.NEXT_PUBLIC_COLYSEUS_URL });
    clientRef.current = client;

    const unsubscribeState = client.subscribeState((state) => {
      setRoomState(state);
      setSessionId(client.sessionId);
      setRoomIdInput((currentRoomId) => currentRoomId || state.roomId);
    });
    const unsubscribeConnection = client.subscribeConnectionState(setConnectionState);
    const unsubscribeError = client.subscribeError((clientError) => {
      setError(clientError.message || "The duel connection reported an error.");
    });

    return () => {
      unsubscribeState();
      unsubscribeConnection();
      unsubscribeError();
      clientRef.current = null;
      void client.dispose();
    };
  }, []);

  const currentRoomId = roomState?.roomId ?? "";
  const currentPlayer = useMemo(
    () => (sessionId && roomState ? roomState.players.get(sessionId) ?? null : null),
    [roomState, sessionId],
  );
  const players = useMemo(
    () => (roomState ? Array.from(roomState.players.values()) : []),
    [roomState],
  );
  const phaseCopy = roomState ? PHASE_COPY[roomState.phase] : null;
  const isBusy = action !== null;

  function getName(): string | null {
    const normalizedName = displayName.trim();
    if (!normalizedName) {
      setError("Enter a display name before joining the circuit.");
      return null;
    }

    return normalizedName;
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = getName();
    const client = clientRef.current;
    if (!name || !client) return;

    setAction("create");
    setError(null);
    setCopyState("idle");

    try {
      const state = await client.createRoom({ displayName: name, wizardId });
      setRoomState(state);
      setRoomIdInput(state.roomId);
      setSessionId(client.sessionId);
    } catch (cause: unknown) {
      setError(readErrorMessage(cause, "Unable to create a duel room."));
    } finally {
      setAction(null);
    }
  }

  async function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = getName();
    const client = clientRef.current;
    const roomId = roomIdInput.trim();
    if (!name || !client) return;
    if (!roomId) {
      setError("Enter a room ID before joining the circuit.");
      return;
    }

    setAction("join");
    setError(null);
    setCopyState("idle");

    try {
      const state = await client.joinRoom(roomId, { displayName: name, wizardId });
      setRoomState(state);
      setRoomIdInput(state.roomId);
      setSessionId(client.sessionId);
    } catch (cause: unknown) {
      setError(readErrorMessage(cause, "Unable to join that duel room."));
    } finally {
      setAction(null);
    }
  }

  function handleReadyToggle() {
    const client = clientRef.current;
    if (!client || !currentPlayer || !roomState || roomState.phase === "playing" || roomState.phase === "finished") {
      return;
    }

    setAction("ready");
    setError(null);
    try {
      if (currentPlayer.ready) {
        client.sendNotReady();
      } else {
        client.sendReady();
      }
    } catch (cause: unknown) {
      setError(readErrorMessage(cause, "Unable to update your ready state."));
    } finally {
      setAction(null);
    }
  }

  async function handleLeave() {
    const client = clientRef.current;
    setAction("leave");
    setError(null);

    try {
      if (client?.currentRoomState) {
        await client.leave("left lobby");
      }
      setRoomState(null);
      setSessionId(null);
      setRoomIdInput("");
      router.push("/");
    } catch (cause: unknown) {
      setError(readErrorMessage(cause, "Unable to leave the duel room."));
    } finally {
      setAction(null);
    }
  }

  async function handleCopyRoomId() {
    if (!currentRoomId) return;

    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable.");
      await navigator.clipboard.writeText(currentRoomId);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1_800);
    } catch {
      setCopyState("error");
      setError("Unable to copy the room ID. Select it and copy it manually.");
    }
  }

  return (
    <main className="multiplayer-page">
      <div className="multiplayer-stars" aria-hidden="true" />
      <div className="multiplayer-orbit multiplayer-orbit-one" aria-hidden="true" />
      <div className="multiplayer-orbit multiplayer-orbit-two" aria-hidden="true" />

      <header className="multiplayer-header">
        <Link className="multiplayer-back" href="/">
          <span aria-hidden="true">←</span> BACK TO MENU
        </Link>
        <div className="brand-lockup multiplayer-brand">
          <div className="brand-mark" aria-hidden="true">✦</div>
          <div>
            <p className="eyebrow">THE ARCANE CIRCUIT</p>
            <h1>WIZARD ARENA</h1>
          </div>
        </div>
        <div className="multiplayer-connection" role="status" aria-live="polite">
          <span className={`status-dot multiplayer-connection-dot is-${connectionState}`} />
          <span>NETWORK / {CONNECTION_LABELS[connectionState]}</span>
        </div>
      </header>

      {error && (
        <div className="multiplayer-error" role="alert">
          <span className="multiplayer-error-mark" aria-hidden="true">!</span>
          <p>{error}</p>
          <button type="button" aria-label="Dismiss error" onClick={() => setError(null)}>×</button>
        </div>
      )}

      {roomState && phaseCopy ? (
        <section className="multiplayer-room" aria-labelledby="multiplayer-room-title">
          <div className="multiplayer-room-heading">
            <div>
              <p className="eyebrow">NETWORK DUEL <span className="eyebrow-divider">/</span> ROOM ACTIVE</p>
              <h2 id="multiplayer-room-title">THE <em>LOBBY.</em></h2>
              <p className="multiplayer-room-lede">Your duel channel is open. Keep this room ID private to the wizards you want to challenge.</p>
            </div>
            <div className={`multiplayer-phase multiplayer-phase-${roomState.phase}`}>
              <span className="status-dot" />
              <span>{phaseCopy.label}</span>
            </div>
          </div>

          <div className="multiplayer-room-id">
            <div>
              <span className="detail-label">ROOM ID</span>
              <strong>{currentRoomId}</strong>
            </div>
            <button className="multiplayer-copy-button" type="button" onClick={handleCopyRoomId}>
              {copyState === "copied" ? "COPIED" : "COPY ROOM ID"}
              <span aria-hidden="true">↗</span>
            </button>
          </div>

          <div className="multiplayer-room-grid">
            <section className="multiplayer-card multiplayer-players-card" aria-labelledby="multiplayer-players-title">
              <div className="multiplayer-card-heading">
                <div>
                  <p className="eyebrow">CIRCUIT ROSTER</p>
                  <h3 id="multiplayer-players-title">PLAYERS</h3>
                </div>
                <span className="multiplayer-player-count">{players.length} <i /> 2</span>
              </div>
              <ul className="multiplayer-player-list">
                {players.map((player, index) => {
                  const isCurrentPlayer = player.sessionId === sessionId;
                  return (
                    <li className="multiplayer-player" key={player.sessionId}>
                      <span className="multiplayer-player-index">0{index + 1}</span>
                      <div className="multiplayer-player-copy">
                        <strong>{player.displayName}{isCurrentPlayer ? <small> YOU</small> : null}</strong>
                        <span>{player.wizardId.toUpperCase()} ASPECT</span>
                      </div>
                      <span className={`multiplayer-ready-state${player.ready ? " is-ready" : ""}`}>
                        <span className="status-dot" /> {player.ready ? "READY" : "WAITING"}
                      </span>
                    </li>
                  );
                })}
                {players.length < 2 && (
                  <li className="multiplayer-player multiplayer-player-empty">
                    <span className="multiplayer-player-index">0{players.length + 1}</span>
                    <div className="multiplayer-player-copy">
                      <strong>OPEN SLOT</strong>
                      <span>ROOM ID REQUIRED</span>
                    </div>
                    <span className="multiplayer-ready-state">AWAITING</span>
                  </li>
                )}
              </ul>
            </section>

            <section className="multiplayer-card multiplayer-status-card" aria-live="polite">
              <p className="eyebrow">ROOM STATUS</p>
              <h3>{phaseCopy.title}</h3>
              <p>{phaseCopy.description}</p>
              {roomState.phase === "finished" ? (
                <p className="multiplayer-winner">
                  {roomState.winnerSessionId === sessionId ? "YOU ARE THE WINNER." : "THE ROOM HAS CLOSED."}
                </p>
              ) : (
                <button
                  className="multiplayer-ready-button"
                  type="button"
                  aria-pressed={Boolean(currentPlayer?.ready)}
                  disabled={!currentPlayer || isBusy || roomState.phase === "playing"}
                  onClick={handleReadyToggle}
                >
                  <span>{currentPlayer?.ready ? "MARK NOT READY" : "READY UP"}</span>
                  <span aria-hidden="true">→</span>
                </button>
              )}
              {roomState.phase === "playing" && <span className="multiplayer-next-note">MATCH RENDERING COMING NEXT</span>}
            </section>
          </div>

          <footer className="multiplayer-room-footer">
            <span><span className="status-dot" /> {CONNECTION_LABELS[connectionState]}</span>
            <span>{roomState.phase === "waiting" ? "SEND THE ROOM ID TO YOUR OPPONENT" : "STAY CONNECTED TO THE CIRCUIT"}</span>
            <button className="multiplayer-leave-button" type="button" disabled={isBusy} onClick={handleLeave}>
              {action === "leave" ? "LEAVING..." : "LEAVE ROOM"} <span aria-hidden="true">↗</span>
            </button>
          </footer>
        </section>
      ) : (
        <section className="multiplayer-hero" aria-labelledby="multiplayer-title">
          <div className="multiplayer-copy">
            <p className="eyebrow">NETWORK DUEL <span className="eyebrow-divider">/</span> TRIAL 02</p>
            <h2 id="multiplayer-title">ENTER THE<br /><em>DUEL.</em></h2>
            <p className="multiplayer-lede">Open a private room for a rival, or step into a duel with the room code they send you.</p>
            <div className="multiplayer-copy-rule"><span /></div>
            <p className="multiplayer-copy-note"><span className="status-dot" /> TWO WIZARDS · ONE ARENA · NO AUDIENCE</p>
          </div>

          <div className="multiplayer-panel">
            <div className="multiplayer-panel-heading">
              <div>
                <p className="eyebrow">CHOOSE YOUR ENTRY</p>
                <h3>DUEL ACCESS</h3>
              </div>
              <span className="multiplayer-panel-index">01 <i /> 02</span>
            </div>

            <div className="multiplayer-panel-body">
              <label className="multiplayer-field">
                <span>DISPLAY NAME</span>
                <input
                  type="text"
                  value={displayName}
                  maxLength={24}
                  autoComplete="nickname"
                  placeholder="LYRA VELL"
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label className="multiplayer-field">
                <span>WIZARD ASPECT</span>
                <select value={wizardId} onChange={(event) => setWizardId(event.target.value)}>
                  {WIZARD_OPTIONS.map((wizard) => (
                    <option value={wizard.id} key={wizard.id}>{wizard.label} · {wizard.detail}</option>
                  ))}
                </select>
              </label>

              <form className="multiplayer-entry" onSubmit={handleCreate}>
                <div className="multiplayer-entry-heading">
                  <span className="multiplayer-entry-symbol">✦</span>
                  <div><strong>CREATE A ROOM</strong><small>SUMMON A PRIVATE DUEL CHANNEL</small></div>
                </div>
                <button className="multiplayer-entry-button" type="submit" disabled={isBusy || !displayName.trim()}>
                  <span>{action === "create" ? "OPENING..." : "CREATE ROOM"}</span><span aria-hidden="true">→</span>
                </button>
              </form>

              <div className="multiplayer-entry-divider"><span>OR JOIN WITH A ROOM ID</span></div>

              <form className="multiplayer-entry multiplayer-entry-join" onSubmit={handleJoin}>
                <label className="multiplayer-field">
                  <span>ROOM ID</span>
                  <input
                    type="text"
                    value={roomIdInput}
                    maxLength={64}
                    spellCheck={false}
                    placeholder="PASTE ROOM ID"
                    onChange={(event) => setRoomIdInput(event.target.value)}
                  />
                </label>
                <button className="multiplayer-entry-button" type="submit" disabled={isBusy || !displayName.trim() || !roomIdInput.trim()}>
                  <span>{action === "join" ? "JOINING..." : "JOIN ROOM"}</span><span aria-hidden="true">→</span>
                </button>
              </form>
            </div>

            <div className="multiplayer-panel-footer">
              <span><span className="status-dot" /> {CONNECTION_LABELS[connectionState]}</span>
              <span>ROOMS HOLD TWO WIZARDS</span>
            </div>
          </div>
        </section>
      )}

      <footer className="multiplayer-footer">
        <span className="multiplayer-footer-note"><span className="status-dot" /> DUEL NETWORK READY</span>
        <div className="multiplayer-footer-meta"><span>LYRA VELL</span><i /><span>EMBER SANCTUM</span><i /><span>BUILD 01.04</span></div>
      </footer>
    </main>
  );
}

function readErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error && cause.message) return cause.message;
  return fallback;
}
