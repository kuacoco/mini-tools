# UX Contract

## Product context

- Audience: the fixed OpenID user authorized to discover the budget and spending tools from the home page.
- Primary jobs: review daily spend in the calendar, inspect a selected day's transactions, and review a current-month bill grouped by category.
- Active locales: Simplified Chinese.
- Timezone/calendar policy: Gregorian date-only queries; the existing cloud function creates Beijing-time query boundaries and transaction display uses the Mini Program device time, matching the existing bill page.
- Accessibility target: WCAG 2.2 AA where Mini Program native controls expose equivalent behavior.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Permission model | `utils/privileged-user.js` fixed `PRIVILEGED_OPENID` comparison | Existing implemented product rule | 2026-09-04 |
| Transaction data | `cloudfunctions/feideeTransactions/index.js` | Cloud-function API contract | 2026-09-04 |
| External data access | `cloudfunctions/feideeTransactions/index.js` whitelist check | Server authorization | 2026-09-04 |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`
- Token ownership model: existing WXSS runtime is canonical; new page-scoped styles mirror `DESIGN.md`.
- Runtime design-system/token source: page WXSS files.
- Token drift gate: compare changed colors and shape values to `DESIGN.md` during review.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Date | Native Mini Program `picker` | Existing Mini Program picker usage | `mode=date`, `fields=month` | Device picker + month reload |
| Toast | `wx.showToast` | Existing pages | permission/error | Device preview |
| Data list | Skyline `scroll-view` + WXML list | Existing bill and calendar pages | chronological daily ledger / monthly category bill | Loading, empty, error |

## Flow ledger

| Operation | Trigger | Pending | Success destination | Failure recovery | Source ref |
|---|---|---|---|---|---|
| Open privileged tool | Home entry for 消费日历 / 预算看板 / 消费账单 | No entry until permission result | Corresponding tool | All three entries remain hidden for non-privileged users | `utils/privileged-user.js` |
| Change month | Native month picker | Stable empty calendar grid | Same calendar, refreshed total and day amounts | Inline error | `feideeTransactions` query |
| Change bill month | Native month picker (`fields=month`) | Stable bill-list footprint | Same page, refreshed category groups and total | Toast and empty state | `fetchFeideeTransactions` |
| Open day | Tap calendar date | None | Day ledger | Day ledger shows inline error | Existing transaction API |
| Read day ledger | Page entry | Stable ledger state | Same page | Inline error or empty state | Existing transaction API |

## Navigation and responsive behavior

- Direct route denial returns to the tool list; this is UX containment, while cloud-function whitelist checks remain the data boundary.
- A calendar day is always tappable, including zero-spend dates.
- The detail page uses a single chronological list and no category groups.
- The monthly bill defaults to the current natural month, uses a single month picker, and keeps the existing category-grouped response presentation.

## Async and resilience

- Each page uses a monotonically increasing request ID, so a late month/day response cannot overwrite a newer request.
- Reads are not retried automatically; users can change month or re-enter the page.
- Loading retains a stable calendar or ledger footprint; errors are inline and do not expose raw credentials.

## Verification

- Static: syntax checks, `git diff --check`, premium audit, and changed-file anti-pattern search.
- Runtime pending: WeChat Developer Tools / device checks for native month picker, loading, empty, API failure, both permission states, and narrow viewport.
