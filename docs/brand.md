# CacheLens — Visual identity

The palette is derived from two things that actually belong to this product's world, rather than
picked for fashion:

1. **Optical lens coatings.** The front element of a real camera lens flares teal-green and
   amber-gold. CacheLens is an instrument of inspection; those are its native colors.
2. **Cache temperature.** .NET developers already say *warm cache* and *cold cache*. Temperature
   is therefore not a metaphor we invented — it's the domain's own vocabulary, so we let it drive
   the whole system. Warm entries read amber; cold/expired entries read slate-blue.

That second point is what makes the palette semantic rather than decorative: an entry's color
tells you its actual state.

## Tokens

### Dark (the native state — this is a dark-first identity)

| Token | Value | Role |
|---|---|---|
| `--ground` | `#0A0F0D` | Page ground. Near-black with a green-cyan bias — the inside of a lens barrel. Not pure black. |
| `--surface` | `#111917` | Raised panels |
| `--surface-2` | `#18211E` | Inset rows, code blocks |
| `--line` | `#23302C` | Hairlines, borders |
| `--ink` | `#E9EFEB` | Primary text |
| `--ink-muted` | `#8C9C95` | Secondary text, labels |
| `--warm` | `#F2A93B` | **Primary.** Warm cache, live values, primary CTA |
| `--lens` | `#37D6AE` | **Secondary.** Connected state, the lens mark. Used sparingly |
| `--cold` | `#7C8FA8` | Expired / cold entries |
| `--alert` | `#E5646E` | Evicted, errors |

### Light

| Token | Value |
|---|---|
| `--ground` | `#F6F8F5` |
| `--surface` | `#FFFFFF` |
| `--surface-2` | `#EDF1EE` |
| `--line` | `#D8E0DA` |
| `--ink` | `#101815` |
| `--ink-muted` | `#5A6B63` |
| `--warm` | `#A96A08` (darkened — the dark-mode amber fails contrast on a light ground) |
| `--lens` | `#0B7D66` |
| `--cold` | `#5A6B7D` |
| `--alert` | `#C2333F` |

**Neutrals carry a slight green bias in both themes.** A pure mid-grey next to amber reads as
unconsidered; the green cast makes the pairing look chosen, and ties the neutrals back to the
lens-barrel ground.

## Typography

- **Display: monospace.** Deliberate, not lazy. The product's entire subject is keys and values;
  mono headlines at large sizes read as terminal banners and put the page in the reader's own
  idiom. Stack: `ui-monospace, 'SF Mono', 'Cascadia Mono', 'JetBrains Mono', Menlo, Consolas`.
- **Body: system humanist sans.** A neutral delivery vehicle so the mono display carries the
  personality alone. Stack: `system-ui, -apple-system, 'Segoe UI', Roboto`.
- **Data: mono with `font-variant-numeric: tabular-nums`**, so TTL countdowns and byte counts
  don't jitter as digits change.

Web fonts are deliberately not used: the Artifact CSP blocks font CDNs, and a silent fallback
would be worse than a well-chosen system stack.

## Icons

Two marks, because the platforms have different constraints:

- **`media/icon.svg` — Activity Bar icon.** Must be **monochrome** (`currentColor`): VS Code
  themes this icon itself and flattens any color we supply, so shipping a colored version would
  just look broken in high-contrast themes. Designed to read at 24px: a lens ring containing
  three stacked entry bars, with a focus tick at the ring's edge.
- **`media/logo.svg` — full-color brand mark.** For the site, the Marketplace listing, and
  README headers. Same geometry, with the warm/lens gradient and a refraction beam through the
  ring.

Keeping the geometry identical between the two means the monochrome icon is recognizably the
same mark, not a separate logo.

## Applying semantic color in the product

The extension uses the temperature system to encode real state, so a glance at the tree tells you
something true:

| State | Color | Where |
|---|---|---|
| Live / warm entry | `--warm` | Value present, not near expiry |
| Expiring soon (&lt; 20% of TTL left) | `--warm` dimmed | Countdown in the inspector |
| Expired | `--cold` | Countdown reads "expired" |
| Redacted | `--ink-muted` | Lock icon, omitted-value notice |
| Evicted / error | `--alert` | Evict action, connection failures |

Semantic color is kept separate from the accent: `--warm` doubles as brand *and* "warm cache"
because in this domain they genuinely are the same idea, but `--alert` and `--cold` never get
used decoratively.
