import { useState } from "react";

interface Props {
  mode: "create" | "unlock";
  busy: boolean;
  error: string | null;
  onSubmit: (passphrase: string) => void;
}

export default function UnlockScreen({ mode, busy, error, onSubmit }: Props) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const create = mode === "create";
  const mismatch = create && confirm.length > 0 && confirm !== pass;
  const tooShort = create && pass.length > 0 && pass.length < 8;
  const canSubmit = pass.length >= 8 && (!create || confirm === pass) && !busy;

  return (
    <div className="flex h-full items-center justify-center p-8">
      <form
        className="card w-full max-w-md"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit(pass);
        }}
      >
        <div className="mb-6 flex items-center gap-3">
          <Crescent />
          <div>
            <h1 className="text-xl font-semibold">{create ? "Create your Hawl store" : "Unlock Hawl"}</h1>
            <p className="text-sm text-ink/60">
              {create ? "Everything you enter is encrypted on this computer with a passphrase only you know." : "Enter your passphrase to decrypt your data."}
            </p>
          </div>
        </div>

        <label className="label" htmlFor="pass">Passphrase</label>
        <input id="pass" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoFocus autoComplete={create ? "new-password" : "current-password"} />
        {tooShort && <p className="help text-red-700">At least 8 characters.</p>}

        {create && (
          <>
            <label className="label mt-4" htmlFor="confirm">Confirm passphrase</label>
            <input id="confirm" type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            {mismatch && <p className="help text-red-700">Passphrases do not match.</p>}
            <p className="help mt-3">There is no recovery. If you forget it, delete the store and start again from your statements.</p>
          </>
        )}

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}

        <button type="submit" className="btn-primary mt-6 w-full" disabled={!canSubmit}>
          {busy ? "Working..." : create ? "Create and continue" : "Unlock"}
        </button>
      </form>
    </div>
  );
}

export function Crescent({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <rect width="1024" height="1024" rx="224" fill="#1f3d2b" />
      <mask id="hawl-cut">
        <rect width="1024" height="1024" fill="#fff" />
        <circle cx="600" cy="452" r="270" fill="#000" />
      </mask>
      <circle cx="512" cy="480" r="300" fill="#e3bf62" mask="url(#hawl-cut)" />
    </svg>
  );
}
