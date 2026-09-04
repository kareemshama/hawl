# Changelog

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
