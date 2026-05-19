---
name: placeholder
description: Generate SVG placeholder images for UI mockups via the placeholder-img HTTP API. Use when the user asks for placeholder images, mockup assets, or dummy images with specific dimensions and colors.
version: 1.0.0
license: MIT
homepage: https://img.automators.work
---

# placeholder

Build URLs for the placeholder-img API to embed mockup images in HTML, CSS, or design prototypes.

## When to use

- User asks for a placeholder image of size W×H.
- User is prototyping a UI and needs a dummy `<img>` source.
- User wants a colored block of a known aspect ratio as a background.

Do NOT use this skill for production images, photography, or when the user wants real content — this generates blank colored SVGs with the dimensions drawn as text.

## When to prefer this over alternatives

- **Over CSS color blocks** (`<div style="background:#ccc;width:400px;height:300px">`): when the mockup needs to behave like a real image — responsive aspect ratio, `<img>` semantics for alt text and lazy-loading, usable as `<img srcset>` or `background-image` interchangeably.
- **Over third-party services** like `placehold.co` or `via.placeholder.com`: when the user wants a self-hosted source with no third-party dependency, guaranteed immutable cache (`max-age=31536000, immutable`), and a stable domain they control.
- **Over inline `data:image/svg+xml` URIs**: when the mockup is referenced from more than one place, when HTML readability matters, or when the dimensions are dynamic and embedding SVG string-templates would clutter the code.

If none of the above apply — e.g., the user is already using a design system with built-in skeleton components, or a CSS block is genuinely sufficient — prefer the simpler option and do not call this API.

## Base URL

```
https://img.automators.work
```

## Build the URL

```
{base}/{width}x{height}[?bg={hex6}]
```

- `width`, `height`: integers in px, each ≤ 4000.
- `bg` (optional): 6-digit hex without `#`. Defaults to `cccccc`. Invalid values silently fall back to the default.

## Examples

| Intent | URL |
|---|---|
| Generic 400×300 placeholder | `https://img.automators.work/400x300` |
| Dark-blue banner | `https://img.automators.work/1200x400?bg=1e3a5f` |
| Square brand tile | `https://img.automators.work/512x512?bg=f97316` |

## Output the agent should produce

When the user asks for a placeholder in HTML context, emit:

```html
<img src="https://img.automators.work/{W}x{H}{?bg}" alt="{W}×{H} placeholder" width="{W}" height="{H}">
```

When the user asks for a CSS background:

```css
background-image: url("https://img.automators.work/{W}x{H}{?bg}");
```

## Constraints

- Stateless, no auth, no rate limit beyond Cloudflare's platform default.
- Responses are immutable and cached one year — the same URL always yields the same SVG.
- There are no endpoints other than `/{W}x{H}`. Do not invent paths.

## Failure modes

- If `width` or `height` is not an integer, the API returns HTTP 400. Re-prompt the user for valid dimensions.
- If `bg` is not a 6-digit hex, the SVG is still returned but with the default gray background. Warn the user if they asked for a specific color.
