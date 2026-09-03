# Hawl: Spec v0.1

Working codename. "Hawl" is the lunar year a Muslim's wealth must be held before zakat is due.

Status: draft, 2026-09-03. Companion to [RULES.md](RULES.md), which holds every fiqh rule the
engine implements. This file describes the product and the software.

## 1. What it is

A local-first desktop app for Windows and macOS that tells a Muslim how much zakat they owe, or
that they are exempt, and shows exactly how it got there. The user imports bank and brokerage
statements, adds assets the statements cannot see, picks a madhab preset, and gets a result with a
line-by-line audit trail. Nothing leaves the machine except a request for the gold and silver
spot price.

## 2. Why this and not another web calculator

Every mainstream calculator (NZF, Zakat Foundation, Islamic Relief, LaunchGood, Zakatify) is a
web form that asks for balances typed by hand, computes one snapshot, and funnels the result to a
donation page. None import statements. Only Zakatify tracks an anniversary date, and none check
whether wealth stayed above nisab across the year. No open-source desktop zakat app exists.

Hawl fills four gaps:

1. Statement import instead of typing balances.
2. True hawl tracking: anniversary on the Hijri calendar, dip detection across the year, and
   missed-year reconstruction from statement history.
3. Madhab differences exposed as explicit, documented settings instead of buried in blog posts.
4. Local-first privacy for financial data.

## 3. Non-goals for v1

- No donation routing or charity integration.
- No bank API connections (Plaid and similar). Files only.
- No mobile version.
- No zakat al-fitr, no agricultural or livestock zakat.
- No bank API connections. PDF, CSV, OFX/QFX, and QIF files are all supported in v1 (see
  section 9), because PDF is the only format many banks offer and it is what most people already
  have saved.
- No tax advice. The app computes zakat under the user's chosen positions and says so.

## 4. Users

- **Primary:** a salaried Muslim in the US or UK with two to six accounts, maybe a 401k or
  pension, some stock, and possibly gold jewellery. Has never tracked a hawl date. Wants a number
  they can trust and a record for next year.
- **Secondary:** a household head calculating for a spouse and children (R6.2, R6.3).
- **Secondary:** someone who has missed years and needs to reconstruct them (R7).

## 5. Core user flow

1. **Setup.** Choose madhab preset (or Custom), currency, nisab metal, and the hawl anniversary.
   If the user does not know their anniversary, the app offers the standard advice: pick a Hijri
   date, commonly in Ramadan, and it becomes the anniversary going forward.
2. **Import.** Drop statement files. The app detects the format and the bank layout, shows the
   parsed transactions and running balances, flags low-confidence columns, and asks the user to
   confirm each account once. Confirmed mappings are remembered per bank.
3. **Add what statements cannot see.** Gold and silver by weight and purity, crypto, retirement
   accounts, stocks, business assets, loans given, property held for resale. Each has a short
   plain-language prompt that maps to a rule number.
4. **Liabilities.** Credit card balances (often already in a statement), next 12 months of loan
   instalments, bills due, unpaid prior zakat.
5. **Result.** Net zakatable wealth, nisab on the anniversary date, verdict (owed or exempt), and
   the amount. Below it, the audit trail: each line item, its source, the rule numbers applied, the
   spot price and its source, the Hijri date and its Gregorian equivalent.
6. **Record.** Save the year. Next year the app pre-fills everything and only asks for new
   statements.

## 6. Architecture

Mirrors Thaw's monorepo so the two projects stay familiar to each other.

```
hawl/
  apps/desktop/          Tauri 2 shell, React + TypeScript + Tailwind UI
    src-tauri/           Rust: statement parsers, SQLite, price fetch, Hijri conversion
  packages/
    core-types/          Shared TS types: Account, Asset, Liability, Snapshot, Result
    zakat-engine/        Pure TypeScript rules engine. No I/O. Exhaustively tested.
  docs/
    RULES.md             Fiqh rules with citations (the source of truth)
    SPEC.md              This file
```

**Rust side (Tauri commands).**

- Statement parsing: `csv` plus `csv-sniffer` for layout detection, `ofx-rs` for OFX/QFX,
  `qif_parser` for QIF. These run in Rust. PDF text extraction runs in the webview with pdf.js
  (and tesseract.js for scanned pages) because that is where the mature, cross-platform libraries
  are; the extracted rows then go through the same Rust normalizer as CSV so every format ends up
  in one transaction model.
- Storage: one encrypted file per profile, `hawl.store`, holding the profile as JSON. XChaCha20-
  Poly1305 with an Argon2id key derived from the passphrase; a fresh nonce on every save and an
  atomic rename so a crash never leaves a half-written file. SQLCipher was the original plan but
  it drags OpenSSL into the Windows build, and the data volume is tiny. SQLite is not ruled out for
  transaction history in M3 if the statement data outgrows a single document.
- Spot prices: `reqwest` against a fallback chain (gold-api.com, goldprice.dev, Swissquote public
  feed), cached daily, always overridable by hand. Every result stores the price used.
- Hijri conversion: ICU4X `icu` crate with the Umm al-Qura calendar, computed in Rust and passed
  to the UI. The webview's own `Intl` implementation is not used because WebView2 and WKWebView
  can disagree by a day at month boundaries.

**TypeScript side.**

- `zakat-engine` takes a `Snapshot` (assets, liabilities, settings, price, date) and returns a
  `Result` with the verdict, the amount, and a list of `Trace` entries, one per line item, each
  carrying the rule numbers from RULES.md. The engine is deterministic and has no dependencies.
- Every setting in RULES.md Part 4 is a field on `Settings`. Madhab presets are just named
  `Settings` objects.
- The UI renders `Trace` entries directly, so the audit trail can never drift from the math.

## 7. Data model (sketch)

- **Profile:** name, madhab preset, settings overrides, currency, hawl anniversary (Hijri).
- **Account:** institution, type (checking, savings, brokerage, retirement, credit card), currency,
  ownership share, column mapping.
- **Transaction:** account, date, amount, description, balance-after, source file, source line.
- **ManualAsset:** category (R4, R8 to R13), fields per category, valuation date.
- **Liability:** category (R5), amount, due date or instalment schedule.
- **Snapshot:** profile, Hijri date, Gregorian date, spot prices, settings frozen at the time.
- **Result:** snapshot, net wealth, nisab, verdict, amount, traces, paid flag and paid date.

## 8. Hawl tracking

- The app builds a daily total-balance series from imported transactions across all accounts.
- Under the start-and-end rule (Hanafi) it evaluates the anniversary date only.
- Under the continuous rule (other madhabs) it scans the series. If the total dipped below nisab
  on any day, it reports the dip, restarts the hawl from the next day nisab was reached, and
  proposes the new anniversary.
- Nisab for historical days uses the stored daily price if available, else the price on the
  nearest cached day, and marks the trace as estimated.
- Missed-year mode walks backward year by year using the same series and the cascade in R7.3.

## 9. Statement import details

- Format detection by extension and content sniff.
- CSV layout detection: fuzzy-match headers against known bank templates (Chase, Bank of America,
  Wells Fargo, Capital One, Ally, Monzo, Barclays, HSBC) and fall back to asking the user to point
  at the date, amount or debit/credit, description, and balance columns.
- Transfers between the user's own accounts are detected by matching amount and date across
  accounts and excluded from any income or spending summary (R15.6).
- Every parsed field carries provenance: file, line or page, and confidence.

**PDF statements.** The goal is the same as for CSV: a dated list of transactions and running
balances so the app can rebuild the daily balance series and show what was carried through the
year. The pipeline, in order of preference:

1. **Text layer extraction.** Most bank PDFs are generated, not scanned, and carry a text layer.
   Extract text with positions per page (pdf.js in the webview, as Thaw does), then reconstruct
   rows by y-coordinate and columns by x-coordinate clusters. Detect the date, description,
   amount or debit/credit, and balance columns with the same header heuristics as CSV, plus a
   consistency check: each row's balance must equal the previous balance plus or minus the amount.
   That check is what makes PDF import trustworthy; rows that fail it are flagged for review.
2. **Statement summary fallback.** If transaction rows cannot be recovered, extract the opening
   balance, closing balance, and statement period from the summary block. That still gives one
   balance point per statement, enough for the anniversary snapshot and a coarse dip check, and
   the app says so in the trace.
3. **OCR for scanned PDFs.** When a page has no text layer, run OCR locally (tesseract.js, as in
   Thaw) and feed the result into step 1. Slower and lower confidence; every OCR value is marked
   estimated.
4. **Local LLM assist (optional, later).** For layouts the heuristics cannot map, Thaw's local
   llama-server extractor can turn the page text into strict JSON. This is opt-in, offline, and
   only reached when steps 1 to 3 fail, so the default install stays small.

Users confirm the detected column mapping once per bank, and the mapping is remembered. Nothing
from a statement is trusted without the running-balance check or an explicit user confirmation.

**Carry-over view.** Once statements are loaded the app shows, per account and in total, the
balance on each day of the hawl, the lowest point and when it happened, the balance on the
anniversary, and whether the total ever dipped below nisab. This is the answer to "what money did
I carry through the year", and it feeds R2.2, R2.3, and R15 directly.

## 10. Privacy and security

- No telemetry. No accounts. No cloud.
- The only network call is the spot price fetch, and it can be turned off in favor of manual
  entry.
- Database encrypted at rest with a user passphrase. Statement files are read, parsed, and not
  copied; the user keeps their originals.
- Export is a local JSON or PDF summary the user chooses to create.

## 11. Platforms and build

- Develop on Windows. Rust and Tauri toolchains already exist here from Thaw.
- GitHub Actions with `tauri-apps/tauri-action`: `windows-latest` produces NSIS and MSI,
  `macos-latest` produces a universal .dmg.
- The MacBook is for smoke testing the .dmg, not daily development.
- macOS signing: a free Apple developer account can sign but not notarize. Without notarization
  users see a "damaged" or "unidentified developer" warning. Decide before public release whether
  to pay for the Developer ID. Until then, ship the .dmg with right-click-Open instructions.

## 12. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Rules research and spec | This document and RULES.md exist. |
| M1 | Engine | `zakat-engine` implements every rule in RULES.md Parts 1 to 3 with a test per rule and per setting. No UI. |
| M2 | Manual-entry app | Tauri shell, setup flow, manual asset and liability entry, result with audit trail, encrypted storage, live spot price. Usable end to end without statements. |
| M3 | Statement import | PDF (text layer, summary fallback, OCR), CSV, OFX/QFX, and QIF parsing with layout detection, running-balance verification, and a confirmation UI. Daily balance series and the carry-over view. |
| M4 | Hawl tracking | Anniversary snapshot, dip detection, missed-year reconstruction. |
| M5 | Release | CI builds both platforms, README, first tagged release. |
| M6 | Scholar review | RULES.md reviewed by at least one qualified scholar; open questions in Part 5 resolved or documented. |

Status on 2026-09-03: M0 through M5 are done, M6 (scholar review) is open. M4 added the Past
years screen (missed-year reconstruction from statement history with per-year price overrides
and cascading unpaid zakat), a hawl status card with a one-click move of the anniversary to the
restart date, and a hawl start date setting. M5 added GitHub Actions CI and a tag-triggered
release workflow building Windows NSIS/MSI and a macOS universal dmg, README, MIT license,
changelog, and a locally verified Windows installer build. M2 shipped with a browser-preview mode (mock
backend when the UI runs outside Tauri) so the interface can be driven by headless QA tools. M3
shipped PDF (text layer and summary), CSV, OFX/QFX, and QIF import, running-balance verification,
cross-file dedupe, the daily balance series, statement-derived cash assets, and the carry-over
chart. Two M3 caveats: the OCR path for scanned PDFs is wired but untested against a real scan,
and tesseract.js fetches its English language data from a CDN on first use, so bundling it
locally is still open. Parsing lives in TypeScript (`packages/statements`) rather than Rust so
the same code serves PDF rows from pdf.js and is unit-tested and QA-able in the browser.

M1 before M2 on purpose. The engine is the part that has to be right, and it is the part a
reviewer and a scholar can check without a UI.

## 13. Open decisions

1. **Name.** "Hawl" is a placeholder. Other candidates: Nisab, Miqdar, Wazn.
2. **Default preset at setup.** Force a choice, or default to Hanafi with silver nisab.
3. **Whether to show income and spending summaries at all.** They are not part of zakat and could
   mislead. Leaning toward showing balance history only.
4. **Apple Developer ID.** See section 11.
5. **Local LLM assist for PDFs.** Ship it in M3 behind an opt-in download, or hold it for a later
   release once the heuristic pipeline has been tried on real statements.

## 14. Review plan

- Claude Code adversarial review on the engine after each milestone (the M1 pass found and fixed
  ten defects).
- A second independent reviewer to be added later.
- Scholar review of RULES.md before public release.
