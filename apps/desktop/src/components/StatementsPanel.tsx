import { useRef, useState } from "react";
import type { AccountKind, ColumnMapping, DateOrder, StatementAccount } from "@hawl/core-types";
import { analyzeFile, applyMapping, commitImport, removeAccount, removeImport, type Review } from "../lib/importer";
import { money } from "../lib/format";
import { newId, type Profile } from "../lib/profile";
import type { SeriesResult } from "@hawl/statements";
import CarryOverChart from "./CarryOverChart";
import type { HijriDate } from "../lib/commands";

interface Props {
  profile: Profile;
  onChange: (p: Profile) => void;
  series: SeriesResult | null;
  anniversary: HijriDate | null;
  nisabValue: number | null;
  windowStart: string | null;
}

const KINDS: { value: AccountKind; label: string }[] = [
  { value: "checking", label: "Checking / current" },
  { value: "savings", label: "Savings" },
  { value: "credit-card", label: "Credit card" },
  { value: "brokerage", label: "Brokerage" },
  { value: "other", label: "Other cash account" },
];

/** One file in a batch. The first item is the one under review; the rest follow its columns and account. */
export interface BatchItem {
  review: Review;
  include: boolean;
}

/** True when a review has something worth importing: rows, or at least a statement balance. */
function hasContent(r: Review): boolean {
  return r.transactions.length > 0 || r.summary?.openingBalance !== undefined || r.summary?.closingBalance !== undefined;
}

function tableWidth(r: Review): number | null {
  if (!r.table) return null;
  return r.table.headers?.length ?? Math.max(0, ...r.table.rows.map((row) => row.length));
}

/** Re-run another file under the lead's columns when the layouts match; otherwise leave it on its own guess. */
function followLead(lead: Review, other: Review): Review {
  if (!lead.mapping || !other.table || !lead.table) return other;
  if (tableWidth(lead) !== tableWidth(other)) return other;
  return applyMapping(other, lead.mapping);
}

/** Build a batch: the first file leads, the others follow its columns. */
function makeBatch(reviews: Review[]): BatchItem[] {
  const [first, ...rest] = reviews;
  if (!first) return [];
  const lead = first.guess?.mapping && first.table ? applyMapping(first, first.guess.mapping) : first;
  const others = rest.map((r) => followLead(lead, r));
  return [lead, ...others].map((review) => ({ review, include: hasContent(review) }));
}

export default function StatementsPanel({ profile, onChange, series, anniversary, nisabValue, windowStart }: Props) {
  const [batch, setBatch] = useState<BatchItem[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lastCommit, setLastCommit] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setError(null);
    setLastCommit(null);
    const reviews: Review[] = [];
    const failed: string[] = [];
    try {
      for (let i = 0; i < list.length; i++) {
        const file = list[i]!;
        const prefix = list.length === 1 ? `Reading ${file.name}` : `Reading ${i + 1} of ${list.length}: ${file.name}`;
        setBusy(prefix);
        try {
          reviews.push(await analyzeFile(file, profile.currency, (m) => setBusy(`${prefix} (${m.toLowerCase()})`)));
        } catch (e) {
          failed.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } finally {
      setBusy(null);
    }
    if (failed.length > 0) setError(failed.length === 1 ? failed[0]! : `${failed.length} files could not be read:\n${failed.join("\n")}`);
    if (reviews.length > 0) setBatch(makeBatch(reviews));
  };

  /** The lead review changed (columns edited). Re-run the followers under the new columns. */
  const updateLead = (lead: Review) => {
    setBatch((items) => {
      if (!items || items.length === 0) return items;
      const rest = items.slice(1).map((it) => {
        const review = followLead(lead, it.review);
        // Keep the user's untick; otherwise follow whether the file has anything to import.
        return { review, include: hasContent(review) && (it.include || !hasContent(it.review)) };
      });
      return [{ review: lead, include: true }, ...rest];
    });
  };

  const toggleItem = (index: number, include: boolean) => {
    setBatch((items) => (items ? items.map((it, i) => (i === index ? { ...it, include } : it)) : items));
  };

  /** Drop the lead file and let the next one take over its own review. */
  const skipLead = () => {
    setBatch((items) => {
      if (!items) return items;
      const rest = items.slice(1);
      return rest.length > 0 ? makeBatch(rest.map((it) => it.review)) : null;
    });
  };

  const commit = (accountId: string, remember: boolean, newAccount?: StatementAccount) => {
    if (!batch || batch.length === 0) return;
    let p = profile;
    if (newAccount) p = { ...p, accounts: [...p.accounts, newAccount] };
    const chosen = batch.filter((it) => it.include);
    const rest = batch.filter((it) => !it.include && hasContent(it.review));
    const empty = batch.filter((it) => !it.include && !hasContent(it.review));
    let added = 0;
    let skipped = 0;
    chosen.forEach((it, i) => {
      const r = commitImport(p, it.review, accountId, remember && i === 0);
      p = r.profile;
      added += r.added;
      skipped += r.skipped;
    });
    onChange(p);
    const files = chosen.length === 1 ? "" : ` from ${chosen.length} statements`;
    const parts = [`${added} transaction${added === 1 ? "" : "s"} added${files}${skipped ? `, ${skipped} already present skipped` : ""}.`];
    if (rest.length > 0) parts.push(`${rest.length} file${rest.length === 1 ? "" : "s"} left to review.`);
    if (empty.length > 0) parts.push(`Nothing to import in ${empty.map((it) => it.review.file).join(", ")}.`);
    setLastCommit(parts.join(" "));
    setBatch(rest.length > 0 ? makeBatch(rest.map((it) => it.review)) : null);
  };

  const lead = batch?.[0]?.review ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h2 className="text-2xl font-semibold">Statements</h2>
        <p className="mt-1 text-sm text-ink/60">
          Drop bank statements to rebuild your balance through the year. Files stay on this computer. PDF, CSV, OFX/QFX, and QIF are accepted.
        </p>
      </header>

      {lead && batch ? (
        <>
          {lastCommit && <div className="rounded-lg bg-moss-50 px-3 py-2 text-sm text-moss-800">{lastCommit}</div>}
          <ReviewCard
            key={`${lead.file}-${batch.length}`}
            review={lead}
            others={batch.slice(1)}
            profile={profile}
            onUpdate={updateLead}
            onToggle={(i, inc) => toggleItem(i + 1, inc)}
            onSkip={batch.length > 1 ? skipLead : undefined}
            onCommit={commit}
            onCancel={() => setBatch(null)}
          />
        </>
      ) : (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFiles(e.dataTransfer.files);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
          }}
          onClick={() => fileRef.current?.click()}
          className={`card flex cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed py-10 text-center transition-colors ${dragOver ? "border-moss-400 bg-moss-50" : "border-sand-300 hover:bg-sand-50"}`}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.csv,.ofx,.qfx,.qif,.txt"
            className="hidden"
            data-testid="statement-file"
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="font-medium">{busy ?? "Drop statements here, or click to choose"}</div>
          <div className="text-sm text-ink/60">A whole year of files at once is fine. Nothing is uploaded anywhere.</div>
          {error && <div className="mt-2 whitespace-pre-line rounded-lg bg-red-50 px-3 py-2 text-left text-sm text-red-800">{error}</div>}
          {lastCommit && <div className="mt-2 rounded-lg bg-moss-50 px-3 py-2 text-sm text-moss-800">{lastCommit}</div>}
        </div>
      )}

      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">Carry-over through the hawl</h3>
          {anniversary && windowStart && <span className="text-xs text-ink/50">{windowStart} to {anniversary.gregorian}</span>}
        </div>
        {series && series.series.length > 0 && nisabValue !== null ? (
          <CarryOverChart series={series.series} nisab={nisabValue} currency={profile.currency} anniversary={anniversary?.gregorian ?? null} />
        ) : (
          <p className="text-sm text-ink/60">Import statements covering the hawl to see the daily balance, the lowest point, and whether it stayed above nisab.</p>
        )}
        {series && series.warnings.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink/70">
            {series.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Accounts</h3>
        {profile.accounts.length === 0 && <div className="card text-sm text-ink/60">No accounts yet. Import a statement and you will be asked which account it belongs to.</div>}
        {profile.accounts.map((a) => {
          const imps = profile.imports.filter((i) => i.accountId === a.id);
          const count = profile.transactions.filter((t) => t.accountId === a.id).length;
          const cov = series?.coverage.find((c) => c.accountId === a.id);
          return (
            <div key={a.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-medium">
                    {a.name} <span className="ml-1 text-xs text-ink/50">{KINDS.find((k) => k.value === a.kind)?.label}</span>
                  </div>
                  <div className="text-xs text-ink/60">
                    {count} transaction{count === 1 ? "" : "s"}
                    {cov?.from && cov.to ? `, balance known ${cov.from} to ${cov.to}` : cov && !cov.anchored && count > 0 ? ", no balance anchor" : ""}
                    {a.kind === "credit-card" && " (statements kept for reference; add the balance owed under Liabilities)"}
                    {a.kind === "brokerage" && " (not cash; enter holdings under Assets)"}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select className="input w-auto py-1" value={a.kind} onChange={(e) => onChange({ ...profile, accounts: profile.accounts.map((x) => (x.id === a.id ? { ...x, kind: e.target.value as AccountKind } : x)) })} aria-label={`Kind of ${a.name}`}>
                    {KINDS.map((k) => (
                      <option key={k.value} value={k.value}>{k.label}</option>
                    ))}
                  </select>
                  <label className="flex items-center gap-1 text-xs text-ink/60" title="Your share of a joint account (R6.3)">
                    share
                    <input
                      className="input num w-16 py-1"
                      inputMode="decimal"
                      aria-label={`Ownership share of ${a.name} in percent`}
                      value={a.ownershipShare === undefined ? "" : String(Math.round(a.ownershipShare * 1000) / 10)}
                      placeholder="100"
                      onChange={(e) => {
                        const v = e.target.value.trim();
                        const n = Number(v);
                        if (v !== "" && !(n >= 0 && n <= 100)) return;
                        onChange({ ...profile, accounts: profile.accounts.map((x) => (x.id === a.id ? (v === "" || n === 100 ? stripKey(x, "ownershipShare") : { ...x, ownershipShare: n / 100 }) : x)) });
                      }}
                    />
                    %
                  </label>
                  {a.currency.toUpperCase() !== profile.currency.toUpperCase() && (
                    <label className="flex items-center gap-1 text-xs text-ink/60" title={`Units of ${profile.currency} per 1 ${a.currency} (R15.4)`}>
                      1 {a.currency} =
                      <input
                        className="input num w-20 py-1"
                        inputMode="decimal"
                        aria-label={`Exchange rate from ${a.currency} to ${profile.currency}`}
                        value={a.fxRateToBase === undefined ? "" : String(a.fxRateToBase)}
                        placeholder="rate"
                        onChange={(e) => {
                          const v = e.target.value.trim();
                          const n = Number(v);
                          if (v !== "" && !(n > 0)) return;
                          onChange({ ...profile, accounts: profile.accounts.map((x) => (x.id === a.id ? (v === "" ? stripKey(x, "fxRateToBase") : { ...x, fxRateToBase: n }) : x)) });
                        }}
                      />
                      {profile.currency}
                    </label>
                  )}
                  <button className="btn-ghost px-3 text-red-700 hover:bg-red-50" onClick={() => onChange(removeAccount(profile, a.id))}>Remove</button>
                </div>
              </div>
              {a.currency.toUpperCase() !== profile.currency.toUpperCase() && a.fxRateToBase === undefined && (
                <p className="mt-2 text-xs text-gold-600">This account is in {a.currency}. Enter the rate to {profile.currency} or it stays out of the calculation.</p>
              )}
              {imps.length > 0 && (
                <ul className="mt-3 divide-y divide-sand-100 text-sm">
                  {imps.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <div className="truncate">{i.file}</div>
                        <div className="text-xs text-ink/50">
                          {i.format.toUpperCase()}, {i.transactionCount} rows{i.periodStart && i.periodEnd ? `, ${i.periodStart} to ${i.periodEnd}` : ""}
                          {i.closingBalance !== undefined ? `, closing ${money(i.closingBalance, profile.currency)}` : ""}
                          {i.balanceVerified ? ", balances verified" : ", balances not verified"}
                        </div>
                      </div>
                      <button className="btn-ghost px-3 text-sm text-red-700 hover:bg-red-50" onClick={() => onChange(removeImport(profile, i.id))}>Remove</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

interface ReviewCardProps {
  review: Review;
  /** The other files in the batch, following this review's columns and account. */
  others?: BatchItem[];
  profile: Profile;
  onUpdate: (r: Review) => void;
  onToggle?: (otherIndex: number, include: boolean) => void;
  onSkip?: () => void;
  onCommit: (accountId: string, remember: boolean, newAccount?: StatementAccount) => void;
  onCancel: () => void;
}

function ReviewCard({ review, others = [], profile, onUpdate, onToggle, onSkip, onCommit, onCancel }: ReviewCardProps) {
  const [accountId, setAccountId] = useState<string>(profile.accounts[0]?.id ?? "new");
  const [newName, setNewName] = useState(guessName(review));
  const [newKind, setNewKind] = useState<AccountKind>(guessKind(review));
  const [remember, setRemember] = useState(true);
  const preview = review.transactions.slice(0, 8);
  const first = review.transactions[0];
  const last = review.transactions[review.transactions.length - 1];
  const canCommit = review.transactions.length > 0 || review.summary?.closingBalance !== undefined;
  const includedOthers = others.filter((o) => o.include).length;
  const importCount = 1 + includedOthers;

  const setMap = (patch: Partial<ColumnMapping>) => {
    if (!review.mapping && !review.table) return;
    const base: ColumnMapping = review.mapping ?? { date: 0, description: 1, dateOrder: "mdy", hasHeader: review.table?.headers !== null };
    const next: ColumnMapping = { ...base, ...patch };
    // Clear the alternative amount representation when one is chosen.
    if (patch.amount !== undefined) {
      delete next.debit;
      delete next.credit;
    }
    if (patch.debit !== undefined || patch.credit !== undefined) delete next.amount;
    onUpdate(applyMapping(review, next));
  };

  const cols = review.table?.headers ?? (review.table ? review.table.rows[0]?.map((_, i) => `Column ${i + 1}`) ?? [] : []);
  const colSelect = (label: string, key: "date" | "description" | "amount" | "debit" | "credit" | "balance") => (
    <div>
      <label className="label text-xs">{label}</label>
      <select className="input py-1" value={review.mapping?.[key] ?? ""} onChange={(e) => setMap({ [key]: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<ColumnMapping>)}>
        <option value="">none</option>
        {cols.map((c, i) => (
          <option key={i} value={i}>{c || `Column ${i + 1}`}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="card space-y-4 border-moss-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Review {review.file}</h3>
          <div className="text-sm text-ink/60">
            {review.format.toUpperCase()}, {review.transactions.length} transaction{review.transactions.length === 1 ? "" : "s"}
            {first && last ? `, ${first.date} to ${last.date}` : ""}
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${review.balanceVerified ? "bg-moss-100 text-moss-800" : "bg-gold-100 text-gold-600"}`}>
          {review.balanceVerified ? "Running balances verified" : "Balances not verified"}
        </span>
      </div>

      {(review.notes.length > 0 || review.warnings.length > 0) && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink/70">
          {[...review.notes, ...review.warnings].map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {review.summary && (review.summary.openingBalance !== undefined || review.summary.closingBalance !== undefined) && (
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <Kv k="Opening balance" v={review.summary.openingBalance !== undefined ? money(review.summary.openingBalance, profile.currency) : "not found"} />
          <Kv k="Closing balance" v={review.summary.closingBalance !== undefined ? money(review.summary.closingBalance, profile.currency) : "not found"} />
          <Kv k="Period" v={review.summary.periodStart && review.summary.periodEnd ? `${review.summary.periodStart} to ${review.summary.periodEnd}` : "not found"} />
        </div>
      )}

      {review.table && (
        <details open={!review.mapping || review.guess?.confidence !== "high"}>
          <summary className="cursor-pointer text-sm font-medium">Columns {review.guess ? `(${review.guess.confidence} confidence)` : ""}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {colSelect("Date", "date")}
            {colSelect("Description", "description")}
            {colSelect("Signed amount", "amount")}
            {colSelect("Money out", "debit")}
            {colSelect("Money in", "credit")}
            {colSelect("Running balance", "balance")}
            <div>
              <label className="label text-xs">Date order</label>
              <select className="input py-1" value={review.mapping?.dateOrder ?? "mdy"} onChange={(e) => setMap({ dateOrder: e.target.value as DateOrder })}>
                <option value="mdy">Month / day / year</option>
                <option value="dmy">Day / month / year</option>
                <option value="ymd">Year / month / day</option>
              </select>
            </div>
          </div>
        </details>
      )}

      {preview.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-sand-200">
          <table className="w-full text-sm">
            <thead className="bg-sand-50 text-left text-xs uppercase text-ink/50">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Amount</th>
                <th className="px-3 py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((t) => (
                <tr key={t.id} className={`border-t border-sand-100 ${t.source.confidence === "low" ? "bg-red-50" : ""}`}>
                  <td className="num px-3 py-1.5">{t.date}</td>
                  <td className="max-w-md truncate px-3 py-1.5">{t.description}</td>
                  <td className={`num px-3 py-1.5 text-right ${t.amount < 0 ? "text-ink" : "text-moss-700"}`}>{money(t.amount, profile.currency, { signed: true })}</td>
                  <td className="num px-3 py-1.5 text-right text-ink/70">{t.balanceAfter !== undefined ? money(t.balanceAfter, profile.currency) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {review.transactions.length > preview.length && <div className="px-3 py-2 text-xs text-ink/50">and {review.transactions.length - preview.length} more</div>}
        </div>
      )}

      {others.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Also in this batch ({others.length} more file{others.length === 1 ? "" : "s"})</h4>
          <p className="text-xs text-ink/60">These go into the same account, using the columns above where the layout matches. Untick any that belong elsewhere; they come back for their own review afterwards.</p>
          <div className="overflow-x-auto rounded-lg border border-sand-200">
            <table className="w-full text-sm">
              <thead className="bg-sand-50 text-left text-xs uppercase text-ink/50">
                <tr>
                  <th className="px-3 py-2"></th>
                  <th className="px-3 py-2">File</th>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2 text-right">Rows</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {others.map((o, i) => {
                  const r = o.review;
                  const dates = r.transactions.map((t) => t.date).sort();
                  const period = r.hint.periodStart && r.hint.periodEnd ? `${r.hint.periodStart} to ${r.hint.periodEnd}` : dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : "";
                  const content = hasContent(r);
                  const status = !content ? "Nothing recognized" : r.balanceVerified ? "Balances verified" : r.transactions.length === 0 ? "Balance only" : "Balances not verified";
                  const tone = !content ? "text-red-700" : r.balanceVerified ? "text-moss-700" : "text-gold-600";
                  return (
                    <tr key={`${r.file}-${i}`} className={`border-t border-sand-100 ${o.include ? "" : "text-ink/40"}`}>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" className="h-4 w-4 accent-moss-700" checked={o.include} disabled={!content} onChange={(e) => onToggle?.(i, e.target.checked)} aria-label={`Include ${r.file}`} />
                      </td>
                      <td className="max-w-xs truncate px-3 py-1.5" title={r.file}>{r.file}</td>
                      <td className="num px-3 py-1.5 text-ink/70">{period}</td>
                      <td className="num px-3 py-1.5 text-right">{r.transactions.length}</td>
                      <td className={`px-3 py-1.5 text-xs ${tone}`} title={[...r.warnings].join("\n")}>
                        {status}
                        {r.warnings.length > 0 && content ? ` (${r.warnings.length} note${r.warnings.length === 1 ? "" : "s"})` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Account</label>
          <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {profile.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
            <option value="new">New account...</option>
          </select>
        </div>
        {accountId === "new" && (
          <>
            <div>
              <label className="label">Account name</label>
              <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div>
              <label className="label">Kind</label>
              <select className="input" value={newKind} onChange={(e) => setNewKind(e.target.value as AccountKind)}>
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
      {review.table && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-moss-700" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember these columns for this account
        </label>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {onSkip && <button className="btn-ghost mr-auto" onClick={onSkip}>Skip this file</button>}
        <button className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button
          className="btn-primary"
          disabled={!canCommit || (accountId === "new" && newName.trim() === "")}
          onClick={() => {
            if (accountId === "new") {
              const acct: StatementAccount = { id: newId(), name: newName.trim(), kind: newKind, currency: review.hint.currency ?? profile.currency };
              onCommit(acct.id, remember, acct);
            } else onCommit(accountId, remember);
          }}
        >
          {importCount > 1 ? `Import ${importCount} statements` : "Import"}
        </button>
      </div>
    </div>
  );
}

function stripKey<T extends object, K extends keyof T>(obj: T, key: K): T {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-sand-50 px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-ink/50">{k}</div>
      <div className="num font-medium">{v}</div>
    </div>
  );
}

function guessName(r: Review): string {
  const base = r.file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  if (r.hint.accountId) return `${base} ${r.hint.accountId.slice(-4)}`.trim();
  return base || "Account";
}

function guessKind(r: Review): AccountKind {
  const t = (r.hint.accountType ?? "").toLowerCase();
  if (/credit|cc/.test(t)) return "credit-card";
  if (/saving/.test(t)) return "savings";
  if (/invest|broker/.test(t)) return "brokerage";
  return "checking";
}
