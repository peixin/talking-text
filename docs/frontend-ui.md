# Frontend UI Guidelines

> Last updated: 2026-06-12 · Chinese version: [`frontend-ui.cn.md`](frontend-ui.cn.md)
>
> The component & style contract for `frontend/`. CLAUDE.md carries the short
> rules; this doc is the reference. If the two disagree, fix both.

---

## 1. Design tokens

All colors live in `frontend/app/globals.css` (`@theme` + `:root`). Components
use **semantic tokens only** — never raw Tailwind palette classes
(`bg-indigo-600`, `text-slate-500`, …). Shade variations are expressed with
opacity modifiers, never palette numbers.

| Token | Hue | Meaning | Typical usage |
|---|---|---|---|
| `primary` | indigo | Brand / interactive | `bg-primary`, `text-primary`, tints `bg-primary/5..10`, borders `border-primary/20..30` |
| `foreground` / `background` | neutral | Default text / page | body text, page background |
| `muted` / `muted-foreground` | neutral | De-emphasized surface / text | section fills `bg-muted`, secondary text |
| `border` / `input` | neutral | Hairlines | `border-border` (default), `border-input` (slightly darker) |
| `card` / `card-foreground` | neutral | Elevated surface | panels, popovers |
| `destructive` | red | Errors, deletion, recording-stop | `text-destructive`, `bg-destructive/10` boxes |
| `success` | emerald | Positive state, subscribed | `text-success`, `bg-success/10` |
| `warning` | amber | Caution, pending, stretch | `text-warning`, `bg-warning/10..15` |
| `ring` | indigo | Focus rings | automatic via base layer |

**Business color semantics** (keep these stable across the app):

- **stretch words** = `warning` · **curriculum words** = `muted` · **wild words** = `primary`
  (single source: `TAG_STYLES` / `TAG_DOT_STYLES` in `app/[locale]/(app)/parent/page.tsx`)
- subscribed / shared-in content = `success` · capture/inbox pending = `warning`

Adding a new business-semantic color = add a CSS variable in `globals.css`
(`:root` + `.dark` + `@theme inline`), not an inline palette class.

**Known gaps (accepted):** `success` and `warning` have no `*-foreground`
companion — use `text-white` on solid fills. Image scrims use `bg-black/NN` +
`text-white` (not palette classes; same as shadcn dialog backdrops).

## 2. Style rules

- **No `dark:` variants.** V1 ships light-only. The `.dark` token block exists
  but nothing toggles it; do not write `dark:` classes outside `components/ui/`.
- **Radius scale:** outer containers `rounded-xl` (Panel), inner elements
  `rounded-lg`, chips `rounded-full` / Badge default, micro-marks `rounded-sm`.
- **Text scale:** body `text-sm`, secondary `text-xs`, micro-labels
  `text-[10px]`/`text-[11px]` (chips, legends).
- **Spinner idiom:** `<Loader2 className="h-4 w-4 animate-spin" />`
  (lucide-react). Do not hand-roll border spinners; size varies, idiom doesn't.
- Hover affordance on an element already at full token strength: step down with
  opacity (`hover:text-primary/80`), don't reach for a darker palette shade.

## 3. Component sourcing

**Library first, hand-write last.**

1. Any standard UI pattern (button, dialog, popover, select, tabs, tooltip,
   badge, switch, toast, …) comes from shadcn/ui. Missing one?
   `pnpm dlx shadcn@latest add <name>` — never hand-write a parallel version.
2. Restyling = tokens/className on the library component. Variants may be added
   inside `components/ui/*` (style-only edits); structural logic stays untouched.
3. Hand-written components are reserved for product-specific UI with no library
   equivalent (record button, chat bubble, tag-tree row). Built from tokens +
   existing primitives.
4. **Promotion rule:** the moment a second page needs the same hand-rolled
   pattern, extract it into `components/` — no copy-paste forks.

## 4. Component inventory

### shadcn (`components/ui/` — managed, style-only edits)

| Component | Use for | Notes |
|---|---|---|
| `button` | Anything that *looks like* a button; link-buttons via `buttonVariants()` | raw `<button>` only for other visual species (chips, tree rows, record button) |
| `badge` | Small non-interactive status/label chips | variants: default/secondary/destructive/outline/**success**/**warning**/ghost/link |
| `alert` | Static message callouts (error/success/warning/info boxes) | variants: default/destructive/**success**/**warning**/**info**; icon = first svg child |
| `card` | True title/description/footer cards | has slot padding + gap; do NOT force onto plain boxes (that's Panel) |
| `dialog`, `popover`, `collapsible`, `separator` | As named | |
| `input`, `textarea`, `label`, `checkbox`, `radio-group` | Forms | |

### Shared custom (`components/`)

| Component | Use for | Notes |
|---|---|---|
| `Panel` | The plain bordered box (`border-border bg-card rounded-xl border p-4`) | drop-in styled div; pass deltas via `className` (twMerge resolves) |
| `EmptyState` | "Nothing here yet" placeholders | dashed border, centered muted message, optional `action`; NOT for drop-zones/interactive affordances |
| `TagPathHeader` | Materials breadcrumb header | |
| `LocaleSwitcher` | Locale dropdown | |

### Quick chooser

- Looks like a button → `Button` / `buttonVariants`
- Small status label → `Badge`
- Message box with semantic tint → `Alert`
- Plain bordered container → `Panel`
- Empty placeholder → `EmptyState`
- Title + body (+footer) card → `Card`
- Loading → `Loader2` idiom

## 5. Internationalization

- Every user-visible string lives in `i18n/messages/{en,zh-CN,zh-TW}.json` —
  **zero hardcoded copy in tsx**, including label maps and aria-labels.
- Namespaces map to pages (`Parent`, `Materials`, `Chat`, `Ingest`, …); keys are
  `snake_case`; dynamic text uses ICU placeholders (`"{count} 本教材"`).
- The three catalogs must stay key-identical — adding a key means adding it to
  all three.
- No `defaultValue:` fallbacks in code — the catalog is the source of truth.
- Navigation always via `@/i18n/routing` helpers (`Link`, `redirect`, …).
- Code comments are English (project language policy); Chinese belongs only in
  `zh-*` catalogs and `*.cn.md` docs.
