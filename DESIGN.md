---
version: alpha
name: "mini-tools"
description: "A Chinese WeChat Mini Program whose new consumption calendar treats daily spend as an at-a-glance ledger."
colors:
  primary: "#173F3D"
  ink: "#173F3D"
  ink-soft: "#244B48"
  mint: "#D6EEE6"
  surface: "#FFFFFF"
  canvas: "#F4FBF7"
  amber: "#F2A950"
  expense: "#D56F38"
typography:
  sans:
    fontFamily: "-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif"
  numeric:
    fontFamily: "-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif"
rounded:
  DEFAULT: "0.5625rem"
  card: "0.8125rem"
  ledger-notch: "0.25rem"
spacing:
  page: "24rpx"
  section: "22rpx"
components:
  spending-calendar: { }
  daily-ledger: { }
---

# mini-tools Design System

## Overview

### Creative North Star

The consumption calendar is a pocket ledger: a month of small ink stamps where deeper green means a more expensive day. It is for the one privileged owner reviewing personal spending on a phone, with a calendar-first route and a direct, chronological daily ledger.

### Product context and register

- **Audience and primary job:** A single permitted owner quickly scans daily spend, then opens a date to review its transactions.
- **Target market(s) and evidence:** Mainland Chinese personal-tool usage; Chinese copy and RMB formatting are established in the workspace.
- **Locale(s) and language policy:** Simplified Chinese, Gregorian calendar, and device-local display of the epoch timestamps returned by the existing expense API.
- **Usage scene:** Short, touch-first phone sessions. The monthly total and every daily amount remain visible without a chart gesture.
- **Register:** Product utility with one expressive data surface.
- **Memorable signature:** The seven-column calendar is a discrete spend heatmap, rather than a generic card dashboard.
- **Restraint:** Details use a quiet, ungrouped ledger so amount, note, account, and time remain scannable.
- **Anti-references:** No copied hero/card grammar from the existing tools; no decorative illustration, fake finance chart, or reliance on color alone.
- **Token ownership/runtime mapping:** Existing app styles are runtime-canonical. New page-scoped WXSS classes use the exact values in this document; no global token change is introduced.

## Colors

`ink` anchors headings and the month summary. `mint` is a low-intensity spend state, progressing through page-local tone classes to ink-adjacent green. `amber` denotes today and the calendar instruction marker. `expense` denotes money leaving the account. White cards sit on `canvas`; error copy uses a distinct warm red tone in the affected page classes.

## Typography

Use the native Chinese system stack. Numeric amounts use bold, tabular-number styling where WXSS supports it; labels are smaller and lighter. English all-caps kickers are only structural captions, never the primary reading path.

## Layout

Every new page has one Skyline `scroll-view` owner below the shared navigation bar. The calendar uses a stable seven-column flex layout with six weeks at most. Page spacing is `24rpx`; all async states reserve the same calendar/list region.

## Elevation & Depth

Thin mint borders establish structure. Shadows are soft and only lift a summary or data surface from the pale canvas. The notched card corner identifies a ledger surface; it is not used on controls.

## Shapes

Small controls use the default `18rpx` radius; data surfaces use `26rpx` with one deliberate `8rpx` ledger notch. Cells are square-edged to preserve a readable calendar grid.

## Components

### Foundational visual states

Tap targets use a brief opacity change. Today receives an amber inset ring; amount intensity is paired with the printed RMB amount. Loading, empty, and error states reserve their list/card footprint.

### Navigation and data display

The month selector is the platform-owned native month picker, chosen because this small Mini Program already uses native pickers and does not own the picker popup. Direct-date navigation always has the calendar page as its owner route.

### Content and data visualization

Use natural Chinese labels. Show money as `¥` plus up to two decimals. The monthly calendar aggregates by date locally from the existing transaction response, while the detail page preserves that response's order.

## Do's and Don'ts

- **Do:** Keep every actual date tappable, including dates with `¥0`.
- **Do:** Keep the day-detail sequence ungrouped and in interface order.
- **Don't:** Copy visual styles or component structure from the existing bill, category, or calendar tools.
- **Don't:** Treat the hidden client-side entry as server authorization.
