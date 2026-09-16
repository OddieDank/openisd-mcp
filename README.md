# openisd-mcp

MCP server (stdio) for the [OpenISD](https://github.com/Johnlon/openisd) Thiele/Small loudspeaker physics engine.

An agent (Claude, opencode, etc.) can:
- `search_drivers("dayton 10")` → match from 1065+ curated `.wdr` drivers
- `get_driver` → full T/S parameters with upstream validation issues (errors block, warns only omit a reference line)
- `design_box` → sealed (target Qtc) or vented (QB3/Thiele alignment) with Vb, Fb, port dimensions, EBP suitability advice
- `simulate` → SPL curve (≈60 points), F3, Qtc/Fc or Fb, max SPL & limiter (Xmax vs power), excursion & impedance peaks; degenerate designs (NaN curves) are rejected before returning
- `evaluate_design` → automated PASS/WARN/FAIL checklist: Qtc/Fb alignment, excursion margin vs Xmax, port velocity/chuffing, F3 extension, SPL limiter, impedance peak, box volume sanity
- `add_driver` → persist a custom driver to the library (generates .wdr via upstream exporter)

All physics comes from the vendored `@openisd/engine` + `@openisd/winisd` (pinned to a commit SHA) — zero reimplementation. The server is stateless: the design lives in the agent's conversation.

## Quick start (opencode / Claude Desktop / any MCP client)

```json
{
  "mcpServers": {
    "openisd-mcp": {
      "command": "npx",
      "args": ["openisd-mcp"]
    }
  }
}
```

**opencode:** `opencode.json` in project root or `~/.config/opencode/opencode.json`
**Claude Desktop:** `claude_desktop_config.json` (see below)

Then ask your agent:
> "Search for 10-inch Dayton drivers and evaluate a sealed box with Qtc 0.707 for the first one"

### Claude Desktop config

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
// %APPDATA%\Claude\claude_desktop_config.json (Windows)
{
  "mcpServers": {
    "openisd-mcp": {
      "command": "npx",
      "args": ["openisd-mcp"]
    }
  }
}
```

## Development (vendoring the engine yourself)

```bash
git clone https://github.com/OddieDank/openisd-mcp
cd openisd-mcp
npm install
npm run vendor   # downloads OpenISD@SHA, compiles, indexes 1065 drivers
npm run build
npm test         # golden regression + flow + self-test
```

The `scripts/vendor.sh` script documents the SHA, applies one documented patch (winisd's workspace import `@openisd/engine` → relative), compiles with tsc, and builds the driver search index using upstream's own `Driver.fromWdr`.

### Updating the vendored engine

```bash
# Edit OPENISD_SHA to a newer commit from Johnlon/openisd
npm run vendor
npm test
```

## Architecture notes

- Vendor commit pinned in `OPENISD_SHA` — reproducible, diffable.
- Engine source is TypeScript with zero deps; compiled to plain JS for runtime stability.
- All tools validate at the boundary (zod) before touching the engine.
- Engine `Result<T>` issues propagate as-is: agent sees `{level:'error'}` vs `{level:'warn'}`.
- `classifyFinite` runs on every sweep — a NaN curve never reaches the agent.
- Self-test at startup mirrors OpenISD's AD-5: golden SPL match (<0.1 dB), vented sweep finite, validation alive.


## License

MIT — same as OpenISD.
