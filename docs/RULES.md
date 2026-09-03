# Zakat Rules Reference

This document is the authoritative source for every rule the Hawl calculation engine implements.
Each rule states the majority position, labels madhab differences, and cites a source.
Anything the engine computes must trace back to a numbered rule here. A scholar should be able to
review this file without reading any code.

Status: research draft, 2026-09-03. Not yet reviewed by a scholar.

Sources are abbreviated: AMJA (Assembly of Muslim Jurists of America), FCNA (Fiqh Council of North
America), NZF (National Zakat Foundation UK), ZF (Zakat Foundation of America), AAOIFI (Accounting
and Auditing Organization for Islamic Financial Institutions), IFG (Islamic Finance Guru),
IslamQA, SeekersGuidance, Joe Bradford.

---

## Part 1: Core rules

### R1. Nisab (minimum threshold)

- **R1.1 Gold nisab.** 20 dinars of pure gold. Modern gram value is either **85 g** (AMJA, NZF,
  most calculators) or **87.48 g** (stricter historical dinar weight). The difference is
  metrological, not a fiqh dispute. Default: 85 g, with 87.48 g selectable.
  Sources: [AMJA nisab fatwa](https://www.amjaonline.org/fatwa/en/79050/how-much-is-the-nisab-for-zakat-now),
  [NZF nisab](https://nzf.org.uk/nisab/)
- **R1.2 Silver nisab.** 200 dirhams of pure silver. Modern gram value is **595 g** (AMJA, NZF) or
  **612.36 g** (stricter). Default: 595 g, with 612.36 g selectable.
  Source: [AMJA gold and silver](https://www.amjaonline.org/fatwa/en/80593/zakat-on-silver-and-gold)
- **R1.3 Which metal applies to cash.** All four madhabs recognize both metals for the metals
  themselves. For cash and mixed wealth, classical Hanafi practice and the large majority of
  contemporary bodies (AMJA, NZF, ZF, Qaradawi) recommend the **silver** nisab because it is the
  lower threshold and benefits the poor. Some individuals and scholars use gold. Default: silver,
  gold selectable.
  Sources: [NZF nisab](https://nzf.org.uk/nisab/), [AMJA zakat](https://www.amjaonline.org/fatwa/en/79978/zakat)
- **R1.4 Nisab value in currency** = grams x spot price per gram of the chosen metal on the
  calculation date. The engine must record the price and its source alongside every result.

### R2. Hawl (the lunar year)

- **R2.1 Duration.** One full Hijri year, about 354 days. The hawl starts the first day
  zakatable net wealth reaches nisab.
  Source: [ZF what is nisab](https://www.zakat.org/what-is-ni-ab-in-islam)
- **R2.2 Dips below nisab during the year.**
  - *Hanafi:* only the start and end dates matter. A mid-year dip does not break the hawl.
  - *Shafi'i, Maliki, Hanbali:* wealth must stay at or above nisab all year. A dip breaks the hawl,
    which restarts when nisab is next reached.
  Sources: [Joe Bradford on hawl](https://joebradford.net/the-hawl-passing-of-one-lunar-year-for-zakat-liability/),
  [NZF on continuous nisab](https://nzf.org.uk/knowledge/is-it-necessary-to-own-zakatable-assets-above-the-nisab-threshold-for-the-entire-year/)
- **R2.3 New income during the year.**
  - *Hanafi:* new wealth of the same kind (more cash) merges into the running hawl and is zakated
    with it at the anniversary.
  - *Shafi'i, Maliki, Hanbali:* wealth from an external source (salary, gift) starts its own hawl.
  Sources: [Joe Bradford](https://joebradford.net/the-hawl-passing-of-one-lunar-year-for-zakat-liability/),
  [IslamQA Shafi'i on money earned during hawl](https://islamqa.org/shafii/darul-iftaa-jordan/227971/ruling-on-money-earned-during-hawl/)
- **R2.4 Practical default.** Contemporary zakat bodies advise picking one fixed Hijri date and
  computing net zakatable wealth on that date every year. This is the Hanafi merge approach in
  practice and is the app's default. Per-deposit hawl tracking is offered as an advanced mode only.
  Source: [ZF when is zakat due](https://www.zakat.org/when-is-zakat-due)
- **R2.5 Calendar.** The anniversary is tracked on the Hijri date, never the Gregorian equivalent.
  A fixed Gregorian date drifts and skips a cycle roughly every 33 years.
  Source: [Umm al-Qura calendar](https://ummalquracalendar.org/)
- **R2.6 Moonsighting caveat.** The Umm al-Qura tabular calendar can differ by one day from local
  moonsighting. The app shows the converted date as a guide, lets the user adjust by plus or minus
  one day, and never presents a single date as authoritative.

### R3. Rate

- **R3.1** 2.5 percent of net zakatable wealth per Hijri year. Agreed by all madhabs.
- **R3.2 Solar year adjustment.** If the user insists on a Gregorian anniversary, the rate becomes
  **2.5775 percent** (365.25 / 354.37 x 2.5) to compensate for the longer year (AAOIFI). The app
  prefers Hijri dates and only applies this when the user selects a Gregorian cycle.
  Sources: [NZF on solar year](https://nzf.org.uk/knowledge/can-a-solar-year-be-used-for-zakat-calculation/),
  [Fincyclopedia zakah base](https://fincyclopedia.net/tutorials/islamic-finance-tutorials/determination-of-zakah-base/)

### R4. Zakatable asset categories (core)

- **R4.1 Cash.** Checking, savings, cash on hand, money-market, prepaid balances, foreign currency
  at spot rate. Fully zakatable.
- **R4.2 Gold and silver.** Bullion and coins are zakatable in all madhabs at weight x spot price
  for the purity (24k = 100 percent, 22k = 91.7 percent, 21k = 87.5 percent, 18k = 75 percent,
  sterling silver = 92.5 percent). Craftsmanship markup and retail price are ignored.
- **R4.3 Personal-use jewellery.**
  - *Hanafi:* zakatable regardless of use.
  - *Shafi'i, Maliki, Hanbali:* exempt when worn as adornment; zakatable if hoarded, held as
    investment, or excessive. Maliki is the most lenient.
  Sources: [IslamQA jewellery](https://islamqa.info/en/answers/59866/zakah-on-jewellery-that-has-been-prepared-for-use),
  [Musaffa on worn jewellery](https://academy.musaffa.com/zakat-on-gold-and-worn-jewelry-guide/)
- **R4.4 Trade goods and inventory.** Valued at current selling price on the due date. Fully
  zakatable. Source: [NZF business guide](https://nzf.org.uk/wp-content/uploads/2020/04/NZF_Zakat-on-Business_Guide.pdf)
- **R4.5 Receivables (money owed to you).**
  - *Strong debt* (cash loan or trade-goods sale proceeds owed by a solvent, reliable debtor):
    include at full value each year. Hanafi and Hanbali allow deferring payment until collected,
    then paying all accumulated years at once.
  - *Weak or doubtful debt* (insolvent or disputing debtor, unpaid dower, unreceived inheritance):
    exclude until collected. Zakat starts from the year received.
  Default: strong debt included annually; weak debt excluded.
  Sources: [Musaffa on receivables](https://academy.musaffa.com/zakat-on-debt-and-receivables-guide/),
  [SeekersGuidance on creditor debt](https://seekersguidance.org/answers/hanafi-fiqh/which-debts-affect-zakat-for-both-debtor-and-creditor/)
- **R4.6 Not zakatable.** Primary residence, personal vehicles, furniture, clothing, tools and
  equipment used in one's own profession. Agreed by all madhabs.

### R5. Deductible liabilities

- **R5.1 Immediate debts** due now or within the coming year: fully deductible (AMJA, NZF,
  Qaradawi).
- **R5.2 Long-term debt** (mortgage, student loan, car loan). Dominant contemporary position:
  deduct only the **next 12 months of scheduled instalments**. AMJA also permits deducting the full
  outstanding balance as a valid but less preferred alternative. Default: 12 months, full balance
  selectable.
  Sources: [AMJA mortgage deduction](https://www.amjaonline.org/fatwa/en/76458/zakat-mortgage-deduction),
  [AMJA paying zakat with a mortgage](https://www.amjaonline.org/fatwa/en/21598/how-to-pay-zakat-while-still-paying-off-a-mortgage)
- **R5.3 Credit card balances.** Deduct the full statement balance; it is demandable in full at any
  time. Source: [Joe Bradford on debt](https://joebradford.net/deducting-debt-from-your-zakat-calculation-what-counts-and-what-doesnt/)
- **R5.4 Bills already due** (utilities, phone, taxes owed): deductible.
- **R5.5 Future rent and bills not yet due:** not deductible under the majority view, because
  ownership on the snapshot date governs, not intended use. NZF notes some scholars allow the
  immediately upcoming payment. Default: not deductible, with a toggle for "current month's due
  bills".
  Source: [NZF deductible debts](https://nzf.org.uk/knowledge/which-debts-can-be-deducted-from-my-zakat-calculation/)
- **R5.6 Unpaid zakat from prior years** is itself a debt and is deducted before computing the
  current year (see R7).

### R6. Who must pay

- **R6.1** Muslim, free, owning nisab-level zakatable net wealth for a full hawl.
- **R6.2 Minors and those lacking capacity.**
  - *Hanafi:* not liable; obligation starts at puberty.
  - *Shafi'i, Maliki, Hanbali, Qaradawi:* the wealth itself is liable and the guardian pays from it.
  The app supports a household mode with a per-person madhab flag for this reason.
  Sources: [ZF on children](https://www.zakat.org/are-children-and-those-lacking-mental-capacity-obligated-to-pay-zakat),
  [NZF on children's wealth](https://nzf.org.uk/knowledge/why-do-the-scholars-differ-in-relation-the-wealth-of-children/)
- **R6.3 Joint accounts.** Liability follows actual ownership share. If undocumented, default to
  an equal split, editable by the user.
  Source: [NZF on joint accounts](https://nzf.org.uk/knowledge/who-is-responsible-to-pay-zakat-on-a-joint-bank-account/)

### R7. Missed years (qada)

- **R7.1** Missed zakat never lapses. It is owed for every year since nisab was first held.
  Source: [SeekersGuidance missed zakat](https://seekersguidance.org/answers/hanafi-fiqh/how-do-i-pay-zakat-from-previous-years/)
- **R7.2 Method.** For each missed Hijri year, estimate net zakatable wealth on that year's
  anniversary from records or a careful conservative estimate, and apply 2.5 percent.
- **R7.3 Cascade.** Each year's unpaid zakat becomes a deductible debt for the following year.
  Compute oldest year first.
  Source: [IslamQA Hanafi on several missed years](https://islamqa.org/hanafi/daruliftaa/8419/if-one-has-not-paid-zakat-for-several-years-how-does-one-calculate-it/)
- **R7.4** No penalty beyond payment. Good-faith estimation is accepted when records are missing.

---

## Part 2: Modern assets

### R8. Retirement accounts (401k, IRA, workplace pensions)

- **R8.1 Accessibility test (AMJA, FCNA).** If the holder can legally withdraw before the due
  date, even with penalty, the account is zakatable this year. If it is genuinely inaccessible
  (employer-locked pension before retirement age, unvested funds), it is exempt until accessed,
  at which point zakat for all prior years is owed in one lump sum.
  Sources: [AMJA on 401k](https://www.amjaonline.org/fatwa/en/21964/zakat-on-401k-or-retirement-plan),
  [FCNA on retirement funds](https://fiqhcouncil.org/zakah-on-retirement-funds/)
- **R8.2 Two accepted methods for accessible accounts (FCNA 2024).**
  - *Net-accessible method:* zakatable base = vested balance minus early-withdrawal penalty minus
    the tax that would be owed minus fees. Then 2.5 percent.
  - *Long-term-investment method:* treat it like buy-and-hold stock (R9.2) and zakat only the
    zakatable-assets proportion of the underlying funds, with no tax or penalty deduction.
  Default: net-accessible method. The other is selectable per account.
- **R8.3 Vesting.** Only the vested portion of employer contributions is owned and zakatable.
- **R8.4 Hardship (FCNA).** If paying on an illiquid account causes hardship, the user may pay
  what they can and record the rest as a liability due when funds become accessible. The app
  tracks this carried balance.
- **R8.5 Strict minority view.** Some scholars zakat the full vested balance with no deductions.
  Selectable, labeled as the strict view.

### R9. Stocks, ETFs, and mutual funds

- **R9.1 Active trading** (bought to resell short term): full market value at 2.5 percent. Held
  by NZF, FCNA, AAOIFI, Joe Bradford.
  Source: [NZF on shares](https://nzf.org.uk/knowledge/shares-unit-trusts-and-equity-investments/)
- **R9.2 Long-term holding:** zakat only on the holder's share of the company's zakatable assets
  (current assets minus current liabilities). Position of AAOIFI Standard 21, the International
  Islamic Fiqh Academy, and FCNA.
  Source: [FCNA on stocks](https://fiqhcouncil.org/zakah-on-stocks/)
  - *Exact method:* (current assets minus current liabilities) x (shares held / shares
    outstanding). Requires balance-sheet data.
    Source: [Joe Bradford on stocks](https://joebradford.net/how-we-calculate-zakat-on-stocks/)
  - *Proxy methods:* **25 percent** of market value (NZF) or **30 percent** (Joe Bradford). For a
    broad US index fund FCNA cites about 24.8 percent. Default proxy: 25 percent, editable.
- **R9.3 Dividends** held as cash on the due date are cash (R4.1). Dividends already spent are not
  zakatable.
- **R9.4 Index funds and ETFs** follow R9.2 as a basket of shares.
- **R9.5 RSUs and stock options** are zakatable once vested, per R9.1 or R9.2 by intent.
  Source: [AMJA on stock options](https://www.amjaonline.org/fatwa/en/83282/zakat-on-stock-options)

### R10. Cryptocurrency

- **R10.1** Treated as currency or trade goods. Full market value at 2.5 percent regardless of
  holding intent, since there is no underlying balance sheet to discount against.
  Source: [IFG on crypto](https://www.islamicfinanceguru.com/articles/calculate-zakat-on-crypto-bitcoin-cryptocurrency)

### R11. Real estate

- **R11.1 Primary home:** exempt. Unanimous.
- **R11.2 Rental property:** the property value is not zakatable. Net rental income remaining on
  the due date is cash (R4.1) at 2.5 percent. This is the NZF and majority view.
  Source: [NZF on rental income](https://nzf.org.uk/knowledge/zakat-on-rental-income/)
  - *Minority view:* 5 to 10 percent on net rental income by analogy to crops. Not implemented in
    v1; noted for a future toggle.
    Source: [ZF on rental property](https://www.zakat.org/is-zakat-owed-on-rental-property)
- **R11.3 Land or property bought to resell:** trade goods (R4.4). Full market value.
- **R11.4 Land held with no intent:** not zakatable until an intent to trade is formed.

### R12. Business assets

- **R12.1 Formula (AAOIFI Standard 9):** (inventory at market value + cash + collectible
  receivables) minus short-term liabilities, then 2.5 percent.
- **R12.2 Fixed assets** used in operations (equipment, premises, vehicles) are exempt.
- **R12.3 Doubtful receivables** are excluded until collected (R4.5).

### R13. Other accounts

- **R13.1 HSA (Health Savings Account):** fully owned, zakatable annually on the balance. Invested
  portions follow R9. Source: [Joe Bradford on HSA and FSA](https://joebradford.net/zakat-on-hsa-fsa-and-employer-benefit-accounts/)
- **R13.2 FSA (Flexible Spending Account):** forfeitable, so not owned wealth. Not zakatable.
- **R13.3 Savings bonds:** zakatable annually at redemption value.
- **R13.4 529 and children's education accounts:** ownership decides. A US 529 controlled by the
  parent is the parent's wealth and follows R8.2 (net of penalty and tax). A UK Junior ISA that
  vests in the child is excluded from the parent and, per most scholars, not zakatable until the
  child takes control. Flagged as needing further sourcing.
- **R13.5 Life insurance cash value:** not settled in the sources found. Provisional treatment:
  the accessible cash-surrender value is zakatable. Flagged for scholarly input.

---

## Part 3: Calculation methodology for statement-based users

### R14. What the calculation is

- **R14.1** Zakat is a snapshot of wealth owned on the anniversary date. Income and expenses
  during the year do not enter the formula. They matter only because they determine the balance on
  the snapshot date.
  Source: [MWA on when zakat is due](https://mwacharity.org/when-is-zakat-due/)
- **R14.2 Formula.**
  net zakatable wealth = sum of zakatable assets (R4, R8 to R13) minus deductible liabilities (R5).
  If net zakatable wealth is at or above nisab (R1) on the anniversary and the hawl condition (R2)
  is met, zakat due = net zakatable wealth x rate (R3). Otherwise the user is exempt for the year.

### R15. Using bank statements

- **R15.1 Anniversary snapshot (default).** Sum the closing balances of all accounts on the Hijri
  anniversary date. Statements supply the balance history so the app can find that date's balance
  even when the statement period does not end on it.
- **R15.2 Lowest-balance check (Shafi'i, Maliki, Hanbali).** Under R2.2 the app scans daily
  balances across the hawl. If the total dipped below nisab, the hawl restarts from the next day
  nisab was reached and the user is told the new anniversary.
- **R15.3 Salaried users.** Only what remains on the snapshot date counts. Money spent before the
  anniversary is not zakatable. Money that landed the day before the anniversary is counted in
  full. There is no prorating by how long a specific sum was held.
- **R15.4 Multiple accounts** are summed across all institutions and currencies, converted at the
  spot rate on the snapshot date.
- **R15.5 Earmarked money** (set aside for bills not yet due) is still owned and still counts
  (R5.5).
- **R15.6 Transfers between the user's own accounts** are not income and must be excluded from
  any income or expense summary the app shows.
- **R15.7 Provenance.** Every figure in a result shows which statement, line, or manual entry it
  came from, the spot price used, the Hijri date used, and the rule numbers applied.

---

## Part 4: Settings the engine exposes

Each of these is a documented divergence, not a preference. The UI groups them under a madhab
preset that the user can override individually.

| Setting | Options | Default | Rule |
|---|---|---|---|
| Madhab preset | Hanafi, Shafi'i, Maliki, Hanbali, Custom | Hanafi (most common among calculator users; user picks at setup) | all |
| Nisab metal | silver, gold | silver | R1.3 |
| Nisab grams | 85 / 595, 87.48 / 612.36 | 85 / 595 | R1.1, R1.2 |
| Hawl dip rule | start-and-end only, continuous | by madhab | R2.2 |
| New income | merge, separate hawl | merge | R2.3 |
| Calendar | Hijri, Gregorian (2.5775 percent) | Hijri | R3.2 |
| Jewellery | zakatable, personal-use exempt | by madhab | R4.3 |
| Long-term debt | 12 months, full balance | 12 months | R5.2 |
| Upcoming bills | not deductible, current month deductible | not deductible | R5.5 |
| Retirement method | net-accessible, long-term proportional, strict full | net-accessible | R8.2 |
| Stock proxy | 25 percent, 30 percent, exact, full | 25 percent | R9.2 |
| Minors' wealth | exempt, liable via guardian | by madhab | R6.2 |
| Hijri adjustment | minus 1, 0, plus 1 day | 0 | R2.6 |

---

## Part 5: Open questions for scholarly review

1. Life insurance cash value (R13.5).
2. Junior ISA and other child-vested accounts (R13.4).
3. Whether to offer the 5 to 10 percent rental income view (R11.2).
4. Whether the Hanafi preset should default to silver nisab and the other presets to gold, or
   whether silver should be universal per contemporary guidance (R1.3).
5. Treatment of buy-now-pay-later and zero-interest instalment plans under R5.
