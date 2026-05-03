"use client";

import { useMemo, useState } from "react";
import GameEmbedPlaceholder from "../../components/game/GameEmbedPlaceholder";

type Lane = "LEFT" | "CENTER" | "RIGHT";
type ShotResult = "GOAL" | "SAVE";
type Phase = "IDLE" | "LOCKED" | "REVEAL" | "FINISHED";

type RoundRecord = {
  round: number;
  playerPick: Lane;
  aiPick: Lane;
  result: ShotResult;
};

const LANES: Lane[] = ["LEFT", "CENTER", "RIGHT"];
const MAX_ROUNDS = 3;
const REVEAL_DELAY_MS = 1200;

function getRandomLane(): Lane {
  const index = Math.floor(Math.random() * LANES.length);
  return LANES[index];
}

function resolveShot(playerPick: Lane, aiPick: Lane): ShotResult {
  return playerPick === aiPick ? "SAVE" : "GOAL";
}

export default function GuestPage() {
  const [currentRound, setCurrentRound] = useState(1);
  const [playerScore, setPlayerScore] = useState(0);
  const [aiSaves, setAiSaves] = useState(0);

  const [selectedLane, setSelectedLane] = useState<Lane | null>(null);
  const [revealedAiPick, setRevealedAiPick] = useState<Lane | null>(null);
  const [lastResult, setLastResult] = useState<ShotResult | null>(null);

  const [history, setHistory] = useState<RoundRecord[]>([]);
  const [phase, setPhase] = useState<Phase>("IDLE");

  const isFinished = phase === "FINISHED";
  const isBusy = phase === "LOCKED" || phase === "REVEAL";

  const statusText = useMemo(() => {
    if (phase === "LOCKED") {
      return "Shot locked. Keeper is reacting...";
    }

    if (phase === "REVEAL") {
      return "Revealing result...";
    }

    if (phase === "FINISHED") {
      if (playerScore > aiSaves) return "Match finished: You win.";
      if (playerScore < aiSaves) return "Match finished: AI wins.";
      return "Match finished: Draw.";
    }

    return `Round ${currentRound} of ${MAX_ROUNDS}`;
  }, [phase, currentRound, playerScore, aiSaves]);

  function resetGame() {
    setCurrentRound(1);
    setPlayerScore(0);
    setAiSaves(0);
    setSelectedLane(null);
    setRevealedAiPick(null);
    setLastResult(null);
    setHistory([]);
    setPhase("IDLE");
  }

  function handlePick(playerPick: Lane) {
    if (isBusy || isFinished) return;

    const aiPick = getRandomLane();
    const result = resolveShot(playerPick, aiPick);

    setSelectedLane(playerPick);
    setRevealedAiPick(null);
    setLastResult(null);
    setPhase("LOCKED");

    window.setTimeout(() => {
      setPhase("REVEAL");
      setRevealedAiPick(aiPick);
      setLastResult(result);

      if (result === "GOAL") {
        setPlayerScore((prev) => prev + 1);
      } else {
        setAiSaves((prev) => prev + 1);
      }

      setHistory((prev) => [
        ...prev,
        {
          round: currentRound,
          playerPick,
          aiPick,
          result,
        },
      ]);

      window.setTimeout(() => {
        if (currentRound >= MAX_ROUNDS) {
          setPhase("FINISHED");
          return;
        }

        setCurrentRound((prev) => prev + 1);
        setSelectedLane(null);
        setRevealedAiPick(null);
        setLastResult(null);
        setPhase("IDLE");
      }, 700);
    }, REVEAL_DELAY_MS);
  }

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Guest Mode</h1>
        <p className="mt-2 text-zinc-400">
          You are playing against AI. Live multiplayer requires an account.
        </p>
      </div>

      <GameEmbedPlaceholder mode="AI" />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-white">Penalty Duel</h2>
                <p className="mt-1 text-sm text-zinc-400">{statusText}</p>
              </div>

              <button
                onClick={resetGame}
                className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-semibold text-white transition hover:border-zinc-500"
              >
                Reset Match
              </button>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {LANES.map((lane) => {
                const isSelected = selectedLane === lane;

                return (
                  <button
                    key={lane}
                    onClick={() => handlePick(lane)}
                    disabled={isBusy || isFinished}
                    className={`rounded-2xl border px-4 py-6 text-base font-semibold transition ${
                      isSelected
                        ? "border-emerald-400 bg-emerald-500/10 text-emerald-300"
                        : "border-zinc-700 bg-zinc-950 text-white hover:border-zinc-500"
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    Shoot {lane}
                  </button>
                );
              })}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-sm text-zinc-400">Your Goals</p>
                <p className="mt-2 text-3xl font-bold text-white">{playerScore}</p>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-sm text-zinc-400">AI Saves</p>
                <p className="mt-2 text-3xl font-bold text-white">{aiSaves}</p>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-sm text-zinc-400">Round</p>
                <p className="mt-2 text-3xl font-bold text-white">
                  {Math.min(currentRound, MAX_ROUNDS)}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
            <h2 className="text-xl font-semibold text-white">Reveal Board</h2>
            <p className="mt-2 text-sm text-zinc-400">
              Same lane = SAVE. Different lane = GOAL.
            </p>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  Your Pick
                </p>
                <p className="mt-2 text-2xl font-bold text-white">
                  {selectedLane ?? "-"}
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  AI Pick
                </p>
                <p className="mt-2 text-2xl font-bold text-white">
                  {phase === "LOCKED" ? "..." : revealedAiPick ?? "-"}
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-xs uppercase tracking-wide text-zinc-500">
                  Outcome
                </p>
                <p
                  className={`mt-2 text-2xl font-bold ${
                    lastResult === "GOAL"
                      ? "text-emerald-300"
                      : lastResult === "SAVE"
                      ? "text-red-300"
                      : "text-white"
                  }`}
                >
                  {phase === "LOCKED" ? "..." : lastResult ?? "-"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h2 className="text-xl font-semibold text-white">Round History</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Fast results, short matches, replay-friendly flow.
          </p>

          <div className="mt-4 space-y-3">
            {history.length === 0 ? (
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
                No rounds played yet.
              </div>
            ) : (
              history.map((item) => (
                <div
                  key={item.round}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 p-4"
                >
                  <p className="text-sm font-semibold text-white">
                    Round {item.round}
                  </p>
                  <p className="mt-2 text-sm text-zinc-400">
                    You: <span className="text-white">{item.playerPick}</span>
                  </p>
                  <p className="text-sm text-zinc-400">
                    AI: <span className="text-white">{item.aiPick}</span>
                  </p>
                  <p
                    className={`mt-2 text-sm font-semibold ${
                      item.result === "GOAL" ? "text-emerald-300" : "text-red-300"
                    }`}
                  >
                    {item.result}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}