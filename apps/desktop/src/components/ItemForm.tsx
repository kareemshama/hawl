import { useState } from "react";
import { buildFromDraft, emptyDraft, draftFrom, isVisible, type Draft, type FieldSpec } from "../lib/forms";

interface Props<K extends string> {
  title: string;
  kinds: readonly { value: K; label: string; rules: string }[];
  fieldsFor: (kind: K) => FieldSpec[];
  initial?: { kind: K; item: Record<string, unknown> } | undefined;
  currency: string;
  onSave: (kind: K, value: Record<string, unknown>) => void;
  onCancel: () => void;
}

export default function ItemForm<K extends string>({ title, kinds, fieldsFor, initial, currency, onSave, onCancel }: Props<K>) {
  const [kind, setKind] = useState<K>(initial?.kind ?? kinds[0]!.value);
  const [draft, setDraft] = useState<Draft>(() => (initial ? draftFrom(initial.item, fieldsFor(initial.kind)) : emptyDraft(fieldsFor(kinds[0]!.value))));
  const [errors, setErrors] = useState<string[]>([]);
  const fields = fieldsFor(kind);
  const kindMeta = kinds.find((k) => k.value === kind);

  const changeKind = (k: K) => {
    setKind(k);
    setDraft((d) => ({ ...emptyDraft(fieldsFor(k)), label: d.label ?? "" }));
    setErrors([]);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const { value, errors } = buildFromDraft(fields, draft);
    if (errors.length) {
      setErrors(errors);
      return;
    }
    onSave(kind, value);
  };

  return (
    <form onSubmit={submit} className="card border-moss-200">
      <div className="mb-4 flex items-start justify-between gap-4">
        <h3 className="text-base font-semibold">{title}</h3>
        {kindMeta && <span className="rule">{kindMeta.rules}</span>}
      </div>

      {!initial && (
        <div className="mb-4">
          <label className="label">Type</label>
          <select className="input" value={kind} onChange={(e) => changeKind(e.target.value as K)}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {fields.filter((f) => isVisible(f, draft)).map((f) => (
          <Field key={f.key} spec={f} draft={draft} currency={currency} onChange={(v) => setDraft((d) => ({ ...d, [f.key]: v }))} />
        ))}
      </div>

      {errors.length > 0 && (
        <ul className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary">{initial ? "Save changes" : "Add"}</button>
      </div>
    </form>
  );
}

function Field({ spec, draft, currency, onChange }: { spec: FieldSpec; draft: Draft; currency: string; onChange: (v: string | boolean) => void }) {
  const id = `f-${spec.key}`;
  const value = draft[spec.key];
  if (spec.type === "checkbox") {
    return (
      <label className="flex items-start gap-3 sm:col-span-2" htmlFor={id}>
        <input id={id} type="checkbox" className="mt-1 h-5 w-5 accent-moss-700" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
        <span>
          <span className="text-sm font-medium">{spec.label}</span>
          {spec.help && <span className="help block">{spec.help}</span>}
        </span>
      </label>
    );
  }
  const wide = spec.type === "select" || spec.key === "label";
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label className="label" htmlFor={id}>
        {spec.label}
        {spec.optional && <span className="ml-1 text-ink/40">(optional)</span>}
      </label>
      {spec.type === "select" ? (
        <select id={id} className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {spec.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      ) : (
        <div className="relative">
          <input
            id={id}
            className={`input ${spec.type !== "text" ? "num" : ""} ${spec.type === "money" || spec.type === "percent" ? "pr-14" : ""}`}
            inputMode={spec.type === "text" ? "text" : "decimal"}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={spec.type === "money" ? "0.00" : spec.type === "percent" ? "0" : ""}
          />
          {spec.type === "money" && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink/50">{currency}</span>}
          {spec.type === "percent" && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-ink/50">%</span>}
        </div>
      )}
      {spec.help && <p className="help">{spec.help}</p>}
    </div>
  );
}
