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
| External data access | Fixed OpenID checks in `feideeTransactions`, `feideeCategoryExpense`, `syncFeideeBudget` | Server authorization | 2026-10-29 |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`
- Token ownership model: existing WXSS runtime is canonical; new page-scoped styles mirror `DESIGN.md`.
- Runtime design-system/token source: page WXSS files.
- Token drift gate: compare changed colors and shape values to `DESIGN.md` during review.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Date | Native Mini Program `picker` | Existing Mini Program picker usage | `mode=date`, `fields=month` | Device picker + month reload |
| Form | Growth page input fields + app validation | `docs/CHILD_GROWTH.md` | decimal cm/kg, native date picker, optional note | `tests/growth.test.js` |
| CRUD | `growth-storage.js` / `growthCrud` | OPENID-owned cloud documents | profile and measurement operations | `tests/growth.test.js` |
| Toast | `wx.showToast` | Existing pages | permission/error | Device preview |
| Data list | Skyline `scroll-view` + WXML list | Existing bill and calendar pages | chronological daily ledger / monthly category bill | Loading, empty, error |

## Flow ledger

| Operation | Trigger | Pending | Success destination | Failure recovery | Source ref |
|---|---|---|---|---|---|
| Open privileged tool | Home 随手记 section: 消费日历 / 消费账单 / 分类支出 / 预算看板 | Section hidden until permission result | Corresponding tool, through shared `onToolTap` | Entire section remains hidden for non-privileged users; 生活工具 remains available | `utils/privileged-user.js`, `pages/index/index.js` |
| Change month | Native month picker | Stable empty calendar grid | Same calendar, refreshed total and day amounts | Inline error | `feideeTransactions` query |
| Change bill period | Shared header: 当天 / 当月 / 上月 / 下月 | Stable bill-list footprint | Same page, refreshed category groups and total | Toast and empty state | `fetchFeideeTransactions` |
| Open day | Tap calendar date | None | Day ledger | Day ledger shows inline error | Existing transaction API |
| Read day ledger | Page entry | Stable ledger state | Same page | Inline error or empty state | Existing transaction API |

## Navigation and responsive behavior

- Direct route denial returns to the tool list; this is UX containment, while cloud-function fixed OpenID checks remain the data boundary. Whitelist administration and its API actions are removed. Only the budget page offers manual sync for the current month. Timer/bulk sync, notification subscriptions and counter APIs are removed; historical database records are untouched. Account configuration remains in admin, while budget configuration and sync controls are removed from admin. The obsolete daily-budget config read and OCR import have also been removed; actual remaining-budget averages are unchanged.
- A calendar day is always tappable, including zero-spend dates.
- The detail page groups transactions by secondary category, sorts groups by numeric subtotal descending and preserves API order within groups, and shows a compact category header with subtotal and no per-group count. Missing categories belong to 未分类.
- The monthly bill defaults to the current natural month, shares the category spending header with today/current-month shortcuts and month pagination, and keeps the existing category-grouped response presentation. Category filters persist when changing periods.

## Async and resilience

- Each page uses a monotonically increasing request ID, so a late month/day response cannot overwrite a newer request.
- Reads are not retried automatically; users can change month or re-enter the page.
- Loading retains a stable calendar or ledger footprint; errors are inline and do not expose raw credentials.

## Verification

- Static: syntax checks, `git diff --check`, premium audit, and changed-file anti-pattern search.
- Runtime pending: WeChat Developer Tools / device checks for native month picker, loading, empty, API failure, both permission states, and narrow viewport.

## Child growth module

- Source: explicit user request and multi-child clarification (2026-11-18); domain contract, provenance, operational setup: `docs/CHILD_GROWTH.md`.
- Visible to all users like the course tool, with private per-OPENID data and no sharing endpoint. Separate child profiles, 20 maximum per account. No child health data written to persistent client storage.
- Add profile → save → activate new profile in the same page. Existing profiles can edit nicknames; birthday/sex lock permanently after the first measurement to preserve reference interpretation, explained before first save.
- Add/edit measurement → save → same child overview/timeline/curve updated. One record per date, no silent overwrite; changing date is atomic and collision-checked. Delete confirms exact date and irreversibility. Cancel with unsaved changes confirms; failed save keeps form data and error text. Busy blocks repeated mutation.
- Server validates every date/value, derives OPENID from context, rechecks document ownership, and applies revision checks in transactions. Request identifiers make unchanged retries idempotent. Profile locking and record write share a transaction. No request from a prior child selection may replace current data.
- Measurements between birth and18th birthday, ≤today; height20–250cm, weight0.5–250kg, at most one decimal. These are input plausibility bounds, not health thresholds. Current device date is the client default; server checks calendar today in Asia/Shanghai.
- Timeline: newest first, group by year, display age and change from prior measurement. First record has no fabricated change; 20 initially, explicit show-more. Curve reads all server cursor pages and never presents a partial read as complete.
- Native Mini Program pickers own date popup behavior, consistent with existing project controls. App-owned sheet has scroll ownership, backdrop dismissal with dirty guard, close affordance, accessible names; native `wx.showModal` is the maintained platform confirmation primitive.
- Reference: CDC 2000 P3–P97, sex- and age-specific, interpolated at official month knots; under2years length and 2+ standing-height reference segments are separate. Graph supports height/weight, current age stage/all0–18years, and tapping record points. Values outside the band remain in the plot's axis bounds. The source/limitations sheet is always reachable; neither inside nor outside band is labelled healthy/unhealthy.
- Verification adapters: `scripts/preview-growth.js` renders actual WXML/WXSS/page handlers with explicitly mocked platform/cloud APIs for browser review. It is not WeChat runtime evidence; actual Skyline/canvas/native keyboard, cloud collections/indexes/transactions still need Developer Tools/device verification after deployment.

## Budget copy selection

- 源月份预算默认未选，切换月份清空勾选；显示加载、空数据和失败重试状态。
- 仅复制勾选的二级分类到打开弹窗时的目标月份，已有分类跳过，保留目标金额和已消费金额。
- 提交期间禁止重复提交、切换月份和关闭；失败保留选择以便重试。
