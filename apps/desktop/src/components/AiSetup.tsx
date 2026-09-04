import { useCallback, useEffect, useState } from "react";
import { aiSetGpu, aiSetup, aiStatus, onAiProgress, type AiStatus, type DownloadProgress } from "../lib/commands";

/** Polls the local AI status once and exposes a refresh. */
export function useAiStatus(): { status: AiStatus | null; ready: boolean; refresh: () => Promise<void> } {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const refresh = useCallback(async () => {
    try {
      setStatus(await aiStatus());
    } catch {
      setStatus(null);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, ready: !!status && status.engineReady && status.modelReady, refresh };
}

function formatBytes(n: number): string {
  if (n <= 0) return "0 MB";
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface Props {
  status: AiStatus | null;
  onChanged: () => Promise<void>;
  /** Short form for the Statements screen: one line and a button. */
  compact?: boolean;
}

/** Status of the local AI with a button that downloads whatever is missing. */
export default function AiSetupCard({ status, onChanged, compact = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = !!status && status.engineReady && status.modelReady;

  useEffect(() => {
    if (!busy) return;
    const un = onAiProgress((p) => setProgress(p));
    return () => {
      void un.then((fn) => fn());
    };
  }, [busy]);

  const setup = async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      await aiSetup();
      await onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleGpu = async (enabled: boolean) => {
    try {
      await aiSetGpu(enabled);
      await onChanged();
    } catch (e) {
      setError(String(e));
    }
  };

  const bar = busy && (
    <div className="space-y-1">
      <div className="text-sm">{progress ? progress.stage : "Contacting GitHub for the AI engine..."}</div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-sand-200">
        <div className="h-2 rounded-full bg-moss-700 transition-all" style={{ width: `${Math.min(100, progress?.percent ?? 0)}%` }} />
      </div>
      {progress && (
        <div className="text-xs text-ink/50">
          {formatBytes(progress.downloaded)}
          {progress.total > 0 ? ` of ${formatBytes(progress.total)}` : ""}
        </div>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className="space-y-2 rounded-lg border border-gold-200 bg-gold-50 p-3 text-left text-sm">
        {ready ? (
          <div>The local AI is ready. Use <span className="font-medium">Read with AI</span> on a statement the parser could not read.</div>
        ) : (
          <div>
            The built-in parser could not read this layout. The local AI can, and it runs on this computer.
            {status ? ` One-time download: ${status.modelLabel}${status.engineReady ? "" : " plus the engine"}.` : ""}
          </div>
        )}
        {bar}
        {error && <div className="text-red-800">{error}</div>}
        {!ready && !busy && (
          <button className="btn-primary" onClick={(e) => { e.stopPropagation(); void setup(); }}>Set up local AI</button>
        )}
      </div>
    );
  }

  return (
    <section className="card space-y-3">
      <h3 className="font-semibold">Local AI</h3>
      <p className="text-sm text-ink/60">
        Reads statements the built-in parser cannot, such as ones laid out in sections without a running balance. It runs on this computer with llama.cpp; the only network use is the one-time download.
      </p>
      {status ? (
        <ul className="space-y-1 text-sm">
          <li>Engine: {status.engineReady ? (status.cudaBuild ? "ready (GPU build)" : "ready (CPU build)") : "not downloaded"}</li>
          <li>Model: {status.modelLabel}, {status.modelReady ? "ready" : "not downloaded"}</li>
          <li>
            Graphics card: {status.gpuDetected ? "NVIDIA GPU detected" : "none detected, runs on the CPU"}
            {status.running ? ", engine running" : ""}
          </li>
        </ul>
      ) : (
        <p className="text-sm text-ink/50">Status unavailable.</p>
      )}
      {status?.cudaBuild && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-moss-700" checked={status.usingGpu} onChange={(e) => void toggleGpu(e.target.checked)} />
          Use the graphics card
        </label>
      )}
      {bar}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
      {!ready && !busy && <button className="btn-primary" onClick={() => void setup()}>Set up local AI</button>}
      {ready && <p className="help">Nothing else to do. Statements that need it are read with the AI from the Statements screen.</p>}
    </section>
  );
}
