type Props = {
  mode: "AI" | "MULTIPLAYER";
};

export default function GameEmbedPlaceholder({ mode }: Props) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Penalty444 Game Window</h2>
          <p className="text-sm text-zinc-400">
            Unity WebGL will be mounted here later.
          </p>
        </div>

        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm text-emerald-300">
          Mode: {mode}
        </span>
      </div>

      <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-950 text-center">
        <div className="space-y-3 px-6">
          <p className="text-lg font-semibold text-white">3D Match Area Placeholder</p>
          <p className="max-w-md text-sm text-zinc-400">
            This area will host the Penalty444 3D match scene later.
          </p>
        </div>
      </div>
    </div>
  );
}