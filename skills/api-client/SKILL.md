---
name: api-client
description: Patterns for consuming the img.automators.work placeholder image API via HTTP. Use when building HTML mockups, CSS backgrounds, or design prototypes that need SVG placeholder images of specific dimensions and colors.
version: 1.0.0
license: MIT
homepage: https://img.automators.work
---

# api-client

Patterns for calling the `img.automators.work` HTTP API to generate SVG placeholder images.

## When to use

- The user needs a placeholder image for a UI mockup.
- The user wants an SVG with specific dimensions (`{width}x{height}`).
- The user wants a colored background (`?bg={hex6}`).
- The user is building HTML or CSS that references a placeholder image.

Do NOT use this skill for:
- Production images, photography, or real content.
- Images larger than 4000px in any dimension.
- When the user is already using a design system with built-in skeleton components.

## Base URL

```
https://img.automators.work
```

## Endpoint

```
GET /{width}x{height}[?bg={hex6}]
```

- `width`, `height`: integers in px, each <= 4000.
- `bg` (optional): 6-digit hex without `#`. Defaults to `cccccc`.

## Python request pattern

```python
import urllib.request

url = "https://img.automators.work/400x300?bg=1e3a5f"
req = urllib.request.Request(url, headers={"Accept": "image/svg+xml"})
with urllib.request.urlopen(req, timeout=15) as resp:
    svg = resp.read().decode("utf-8")
```

## Error handling

```python
import urllib.error

try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        svg = resp.read().decode("utf-8")
except urllib.error.HTTPError as e:
    if e.code == 400:
        raise RuntimeError("Invalid dimensions: must be integers in format {width}x{height}")
    raise RuntimeError(f"HTTP {e.code}: {e.reason}")
except urllib.error.URLError as e:
    raise RuntimeError(f"Connection failed: {e.reason}")
```

## Constraints

- Stateless, no auth, no rate limit beyond Cloudflare platform default.
- Responses are immutable and cached one year.
- Only endpoint is `/{W}x{H}`. Do not invent paths.

## Failure modes

- HTTP 400: `width` or `height` is not an integer, or path does not match `{int}x{int}`.
- Invalid `bg`: SVG still returns but with default gray background (`cccccc`).
