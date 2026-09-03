import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/commands";

// Resolved lazily: getCurrentWindow() throws outside the Tauri webview.
const win = () => getCurrentWindow();

function handleDragStart(e: React.MouseEvent) {
  if (isTauri && e.button === 0) void win().startDragging();
}

export default function TitleBar({ right }: { right?: React.ReactNode }) {
  return (
    <div onMouseDown={handleDragStart} className="flex h-9 shrink-0 select-none items-center justify-between bg-sand-100">
      <div className="pointer-events-none flex items-center gap-2 pl-3 text-xs tracking-wide text-ink/50">
        <span className="font-semibold text-ink/80">Hawl</span>
        {!isTauri && <span className="rounded bg-gold-100 px-1.5 py-0.5 text-[10px] text-gold-600">browser preview</span>}
      </div>
      <div className="pointer-events-auto flex h-full items-center">
        {right}
        {isTauri && (
          <>
            <button onMouseDown={(e) => e.stopPropagation()} onClick={() => void win().minimize()} className="flex h-full w-12 items-center justify-center text-ink/50 transition-colors hover:bg-sand-200 hover:text-ink" tabIndex={-1} aria-label="Minimize">
              <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1" /></svg>
            </button>
            <button onMouseDown={(e) => e.stopPropagation()} onClick={() => void win().toggleMaximize()} className="flex h-full w-12 items-center justify-center text-ink/50 transition-colors hover:bg-sand-200 hover:text-ink" tabIndex={-1} aria-label="Maximize">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
            </button>
            <button onMouseDown={(e) => e.stopPropagation()} onClick={() => void win().close()} className="flex h-full w-12 items-center justify-center text-ink/50 transition-colors hover:bg-red-500 hover:text-white" tabIndex={-1} aria-label="Close">
              <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2"><line x1="0" y1="0" x2="10" y2="10" /><line x1="10" y1="0" x2="0" y2="10" /></svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
