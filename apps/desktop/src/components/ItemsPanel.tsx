import { useState } from "react";
import type { Trace } from "@hawl/core-types";
import type { FieldSpec } from "../lib/forms";
import { money } from "../lib/format";
import ItemForm from "./ItemForm";

interface Item {
  id: string;
  kind: string;
  label: string;
}

interface Props<K extends string, T extends Item> {
  title: string;
  intro: string;
  emptyText: string;
  items: T[];
  kinds: readonly { value: K; label: string; rules: string }[];
  fieldsFor: (kind: K) => FieldSpec[];
  currency: string;
  traces: Map<string, Trace>;
  /** Word for the right-hand figure, e.g. "zakatable" or "deductible". */
  figureWord: string;
  onChange: (items: T[]) => void;
  makeItem: (kind: K, value: Record<string, unknown>, id: string) => T;
}

export default function ItemsPanel<K extends string, T extends Item>({ title, intro, emptyText, items, kinds, fieldsFor, currency, traces, figureWord, onChange, makeItem }: Props<K, T>) {
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const kindLabel = (k: string) => kinds.find((x) => x.value === k)?.label ?? k;

  const save = (kind: K, value: Record<string, unknown>) => {
    if (editing === "new") {
      onChange([...items, makeItem(kind, value, crypto.randomUUID())]);
    } else if (editing) {
      onChange(items.map((it) => (it.id === editing ? makeItem(kind, value, it.id) : it)));
    }
    setEditing(null);
  };

  const remove = (id: string) => onChange(items.filter((it) => it.id !== id));

  const total = items.reduce((s, it) => s + (traces.get(it.id)?.zakatable ?? 0), 0);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-ink/60">{intro}</p>
        </div>
        {editing === null && (
          <button className="btn-primary" onClick={() => setEditing("new")}>Add</button>
        )}
      </div>

      {editing === "new" && (
        <div className="mb-5">
          <ItemForm title={`New ${title.toLowerCase().replace(/s$/, "")}`} kinds={kinds} fieldsFor={fieldsFor} currency={currency} onSave={save} onCancel={() => setEditing(null)} />
        </div>
      )}

      {items.length === 0 && editing === null && (
        <div className="card text-center text-ink/60">{emptyText}</div>
      )}

      <ul className="space-y-3">
        {items.map((it) => {
          const t = traces.get(it.id);
          if (editing === it.id) {
            return (
              <li key={it.id}>
                <ItemForm title={`Edit ${it.label}`} kinds={kinds} fieldsFor={fieldsFor} currency={currency} initial={{ kind: it.kind as K, item: it as unknown as Record<string, unknown> }} onSave={save} onCancel={() => setEditing(null)} />
              </li>
            );
          }
          return (
            <li key={it.id} className="card flex items-center gap-4 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{it.label}</span>
                  <span className="text-xs text-ink/50">{kindLabel(it.kind)}</span>
                  {t?.rules.map((r) => (
                    <span key={r} className="rule">{r}</span>
                  ))}
                </div>
                {t?.note && <div className="mt-1 text-sm text-ink/60">{t.note}</div>}
              </div>
              <div className="text-right">
                {t && (
                  <>
                    <div className="num font-semibold">{money(t.zakatable, currency)}</div>
                    <div className="text-xs text-ink/50">
                      {figureWord}
                      {t.input !== t.zakatable && <> of {money(t.input, currency)}</>}
                    </div>
                  </>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <button className="btn-ghost px-3" onClick={() => setEditing(it.id)} aria-label={`Edit ${it.label}`}>Edit</button>
                <button className="btn-ghost px-3 text-red-700 hover:bg-red-50" onClick={() => remove(it.id)} aria-label={`Remove ${it.label}`}>Remove</button>
              </div>
            </li>
          );
        })}
      </ul>

      {items.length > 0 && (
        <div className="mt-4 flex justify-end text-sm text-ink/70">
          Total {figureWord}: <span className="num ml-2 font-semibold text-ink">{money(total, currency)}</span>
        </div>
      )}
    </div>
  );
}
