# Truncation Audit (pin 86dc686)

## Why ~2000 lines / 50KB

- **Lines**: agent context budget — unbounded dumps burn tokens/latency.
- **Bytes**: long-line / minified files that are few lines but huge.

Whichever limit fires first wins; no partial lines (except bash tail edge case).

## Options

| id | summary | risk |
|---|---|---|
| env-config | `PI_TOOL_MAX_LINES` / `PI_TOOL_MAX_BYTES`, default official | low |
| per-call | optional params on tools | medium (schema growth) |
| remove-hardcap | delete caps | high (semantic break) |
| stream-page | caps + continuation | low |

## Recommended

**env-config** — keep official schema shape; harness / embed can raise caps explicitly. No silent semantic change.

