# Changelog

## 0.5.0 (2026-09-04)

The Statements screen is now an Import page that leads with the answer.

- Drop a year of files. Every file that reconciles against its own opening and closing balance
  goes into a "Ready to import" list: pick the account once and import them in one click. Only
  files that did not reconcile go through the per-file review.
- Coverage card: how many statements and accounts, the earliest and latest date covered, a
  month strip per account against the hawl window, and the exact date ranges still missing.
- What counts card: lowest balance in the year and its date, the balance on the anniversary,
  whether it stayed above nisab, and the cash counted toward zakat with the rule numbers, above
  the carry-over chart.
- Accounts and files are collapsed at the bottom.
- The statement's own period is labelled "Statement period" so it is not read as the hawl.

## 0.4.1 (2026-09-04)

Fixes from the first run on real Bank of America statements, where every file failed with
"The AI answer was not valid JSON": the model's reply was cut off by the output limit on dense
pages.

- Pages are sent to the model in pieces of about 2,000 characters, cut just before a date so no
  transaction is split. When the model returns fewer rows than the piece plainly contains, the
  piece is split in two and read again, down to a floor. A reply that still hits the limit is
  salvaged up to the last complete row and the review says which pages were cut short.
- Choice of model in Settings: Qwen2.5 3B (2 GB, any computer) or Qwen2.5 7B (4.7 GB), with 7B
  the default when an NVIDIA card is present. On the synthetic Bank of America pages the 3B model
  drops rows from dense lists unless pieces are small; the 7B model does not.
- Output limit raised to 12,000 tokens and the context to 32k.

## 0.4.0 (2026-09-04)

- Local AI for statements the built-in parser cannot read, such as Bank of America's layout with
  sections instead of one table and no running-balance column. Same approach as Thaw: llama.cpp's
  server and a Qwen2.5 3B model (about 2 GB) are downloaded once from Settings, run on this
  computer (on the graphics card when there is one), and read each page into a table of dated,
  signed rows. The result goes through the same review, duplicate check, and balance check as
  every other import; when the statement has no running balances, the rows are checked against
  its opening and closing balance instead. The AI is used automatically when the parser finds
  nothing, and a "Read with AI" button on the review re-reads any PDF whose rows look wrong.
- The statement summary parser now reads "Beginning balance on March 1, 2026 $4,210.55", where a
  date sits between the label and the amount.

## 0.3.0 (2026-09-04)

- Import a whole year of statements at once. Drop or choose many files; the first is reviewed
  as before and its columns and account apply to every file with the same layout. A table lists
  the rest with rows found and whether balances verified. Untick a file that belongs to another
  account and it comes back for its own review. Duplicates across files are still skipped.
- Drag and drop works in the desktop app. Tauri's own drop handler was swallowing the drop
  before the page saw it.

## 0.2.0 (2026-09-04)

- The passphrase is gone. Hawl is opened about once a year, and a forgotten passphrase with no
  recovery meant starting over. The profile is now one readable JSON file, `hawl.json`, in the
  app data folder. Settings shows where it is and has a "Delete all data" button.
- Stores created by 0.1.0 and 0.1.1 (`hawl.store`) are not read or migrated; they are left in
  place. Those releases were public for one day.

## 0.1.1 (2026-09-03)

Fixes from an independent adversarial review (Codex) of the engine and statement parser.

- A hawl start date less than a year before the anniversary now makes the hawl incomplete,
  whatever the balances show, and the note says when the year completes.
- Days without balance history inside the hawl window are counted and reported instead of being
  treated as above nisab.
- Statement accounts in another currency need an exchange rate to the profile currency; without
  one they are left out with a warning instead of being added at face value.
- Statement accounts have an ownership share for joint accounts.
- Every statement's opening and closing balance now anchors the balance history, so a later
  statement no longer hides an earlier one.
- Newest-first files that keep same-day rows in posting order are reordered without breaking the
  running-balance chain.
- Amounts with two negative markers, such as "-100.00-", stay negative.
- The business shortfall warning now says how to record personal liability for it.

## 0.1.0 (2026-09-03)

First release.

- Rules engine covering nisab, hawl, rate, asset and liability categories, madhab presets, and
  missed-year cascading, with every result line citing docs/RULES.md.
- Desktop app for Windows and macOS: encrypted local store, setup wizard, manual assets and
  liabilities, live gold and silver prices with manual override, audit trail, recorded years.
- Statement import: PDF (text layer and summary), CSV, OFX/QFX, QIF, running-balance verification,
  duplicate detection across files, daily balance series, carry-over chart.
- Past-year reconstruction from statement history.
