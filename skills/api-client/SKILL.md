---
name: api-client
description: Generic HTTP API client patterns for consuming REST and JSON APIs. Use when the user asks to call an external API, fetch data from a web service, or interact with a documented HTTP endpoint.
version: 1.0.0
license: MIT
homepage: https://img.automators.work
---

# api-client

Reusable patterns for making HTTP requests against REST and JSON APIs.

## When to use

- The user wants to call a documented API endpoint.
- The user says "fetch data from X" or "get data from X API".
- The user provides a URL and expects JSON back.

Do NOT use this skill when:
- The API requires OAuth 2.0 or complex authentication flows not described in the request.
- The API is behind a paywall or requires API keys the user has not provided.
- The task is better handled by a dedicated skill published by that API's domain.

## Base patterns

### GET request

```python
import urllib.request
import json

url = "https://api.example.com/v1/resource"
req = urllib.request.Request(url, headers={"Accept": "application/json"})
with urllib.request.urlopen(req, timeout=15) as resp:
    data = json.loads(resp.read().decode("utf-8"))
```

### POST request with JSON body

```python
import urllib.request
import json

url = "https://api.example.com/v1/resource"
payload = json.dumps({"key": "value"}).encode("utf-8")
req = urllib.request.Request(
    url,
    data=payload,
    headers={
        "Content-Type": "application/json",
        "Accept": "application/json",
    },
    method="POST",
)
with urllib.request.urlopen(req, timeout=15) as resp:
    data = json.loads(resp.read().decode("utf-8"))
```

### Error handling

```python
try:
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    # e.code contains the HTTP status code
    error_body = e.read().decode("utf-8", errors="replace")
    raise RuntimeError(f"HTTP {e.code}: {error_body}")
except urllib.error.URLError as e:
    raise RuntimeError(f"Connection failed: {e.reason}")
```

## Headers to send by default

- `Accept: application/json`
- `User-Agent: agent-name/1.0`

If the API documentation specifies additional headers (like `Authorization`), include them.

## Response handling

1. Always check HTTP status code before parsing body.
2. Parse JSON with `json.loads()`.
3. If the response is not JSON, return the raw text or warn the user.

## Failure modes

- **Timeout**: APIs may be slow. Use a timeout of at least 15 seconds.
- **Rate limiting**: If the response is HTTP 429, wait and retry once with exponential backoff.
- **Invalid JSON**: Wrap `json.loads()` in a try/except and report the raw body to the user.
- **Auth required**: If the API returns 401/403 and no auth method is known, ask the user for credentials or an API key.
