# openisd-mcp

MCP server (stdio) for the [OpenISD](https://github.com/Johnlon/openisd) Thiele/Small loudspeaker physics engine.

An agent (Claude, opencode, etc.) can:
- `search_drivers("dayton 10")` → match from 1065+ curated `.wdr` drivers
- `get_driver` → full T/S parameters with upstream validation issues (errors block, warns only omit a reference line)
- `design_box` → sealed (target Qtc) or vented (QB3/Thiele alignment) with Vb, Fb, port dimensions, EBP suitability advice
- `simulate` → SPL curve (≈60 points), F3, Qtc/Fc or Fb, max SPL & limiter (Xmax vs power), excursion & impedance peaks; degenerate designs (NaN curves) are rejected before returning

All physics comes from the vendored `@openisd/engine` + `@openisd/winisd` (pinned to a commit SHA) — zero reimplementation. The server is stateless: the design lives in the agent's conversation.

## Quick start (opencode)

```bash
npm install -g @opencode-ai/cli
git clone https://github.com/OddieDank/openisd-mcp
cd openisd-mcp
opencode mcp add openisd-mcp -- node /path/to/openisd-mcp/dist/index.js
opencode run "Design a closed box with Qtc 0.707 for the Dayton driver ND105-8 of the library"
```

## Quick start (Claude Desktop)

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
// %APPDATA%\Claude\claude_desktop_config.json (Windows)
{
  "mcpServers": {
    "openisd-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/openisd-mcp/dist/index.js"]
    }
  }
}
```

Then in Claude: "Design a closed box with Qtc 0.707 for the Dayton driver ND105-8 of the library".

## Updating the vendored engine

```bash
# Edit OPENISD_SHA to a newer commit from Johnlon/openisd
npm run vendor   # downloads, compiles, indexes
npm test         # golden regression + flow + self-test
```

The `scripts/vendor.sh` script documents the SHA, applies one documented patch (winisd's workspace import `@openisd/engine` → relative), compiles with tsc, and builds the driver search index using upstream's own `Driver.fromWdr`.

## Architecture notes

- Vendor commit pinned in `OPENISD_SHA` — reproducible, diffable.
- Engine source is TypeScript with zero deps; compiled to plain JS for runtime stability.
- All tools validate at the boundary (zod) before touching the engine.
- Engine `Result<T>` issues propagate as-is: agent sees `{level:'error'}` vs `{level:'warn'}`.
- `classifyFinite` runs on every sweep — a NaN curve never reaches the agent.
- Self-test at startup mirrors OpenISD's AD-5: golden SPL match (<0.1 dB), vented sweep finite, validation alive.

## License

MIT — same as OpenISD.
