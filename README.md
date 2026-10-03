# opencode + IDA Pro MCP — Install

Adds multi-instance orchestration on top of [`mrexodia/ida-pro-mcp`](https://github.com/mrexodia/ida-pro-mcp).
Lets the opencode agent discover, launch, call, save and close **any number** of live IDA
instances (ports 13337+) — **without restarting opencode**.

## What you get

Five native tools the agent sees automatically:

| Tool | Purpose |
|---|---|
| `ida_mcp_instances` | List live IDA MCP instances (port, binary, tool count, idb path) |
| `ida_mcp_tools` | Full catalog of IDA tools with parameters (`tools/list`) — call this first when unsure which IDA tool or args to use |
| `ida_mcp_call` | Call any IDA tool (`decompile`, `lookup_funcs`, `xrefs_to`, `py_eval`, …) |
| `ida_mcp_open` | Launch IDA headless: `ida.exe -A -p <file>` |
| `ida_mcp_close` | Save idb + `qexit` + kill PID + remove instance file |

The tool file rescans `127.0.0.1:13337–13356` on **every call**, so new/closed IDA
instances appear/disappear immediately — no opencode restart.

## Files

```
mcp-ida.js          opencode plugin (file://) — registers live instances as remote MCP servers
tool/ida_mcp.js     the 5 native tools (main file)
ideamcp.ps1         optional PowerShell helper (manual fallback)
```

## Requirements

- **opencode desktop** installed (`C:\Users\<user>\AppData\Local\Programs\@opencode-aidesktop\`)
- **IDA Pro 8.3+** (not Free) with [`ida-pro-mcp`](https://github.com/mrexodia/ida-pro-mcp) installed:
  ```bash
  pip install https://github.com/mrexodia/ida-pro-mcp/archive/refs/heads/main.zip
  ida-pro-mcp --install
  ```
  Each running IDA grabs the next free port from 13337–13356 and writes
  `%APPDATA%\Hex-Rays\IDA Pro\mcp\instances\instance_<port>.json`.
- **Node** (for `npm install` in the config dir; opencode handles the rest).

## Install

All paths below are relative to `<opencode>` = `C:\Users\<user>\.config\opencode\`.

### 1. Copy the files

```
mcp-ida.js         →  <opencode>\mcp-ida.js
tool\ida_mcp.js    →  <opencode>\tool\ida_mcp.js
ideamcp.ps1        →  <opencode>\ideamcp.ps1   (optional)
```

> The filename becomes the tool prefix: `ida_mcp.js` → `ida_mcp_instances`,
> `ida_mcp_tools`, `ida_mcp_call`, `ida_mcp_open`, `ida_mcp_close`.

### 2. Create `package.json` in `<opencode>\`

```json
{
  "type": "module",
  "dependencies": {
    "@opencode-ai/plugin": "1.18.29"
  }
}
```

Then:

```bash
cd C:\Users\<user>\.config\opencode
npm install
```

> `"type": "module"` is required — the plugin uses ESM. Missing it → silent black screen.
> Missing `node_modules` → opencode hangs on black screen at startup.

### 3. Edit `<opencode>\opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "ida-pro-mcp": {
      "type": "remote",
      "url": "http://127.0.0.1:13337/mcp"
    }
  },
  "plugin": [
    "file:///C:/Users/<user>/.config/opencode/mcp-ida.js"
  ]
}
```

- `mcp.ida-pro-mcp` — static server on port 13337. If no IDA is listening, you get a
  *"server unavailable"* warning, not a crash.
- `plugin` — must use `file:///` with **forward slashes**, not backslashes.

### 4. Set the IDA path

In `mcp-ida.js`, `tool/ida_mcp.js` and `ideamcp.ps1`, change:

```js
const IDA_EXE = process.env.IDA_EXE || 'X:\\<full path>\\ida.exe'
```

Or set the `IDA_EXE` environment variable and leave the default.

### 5. Optional — PowerShell helpers

Add to your PowerShell profile:

```powershell
. "$HOME\.config\opencode\ideamcp.ps1"
```

Gives you `ida-ports`, `ida-open`, `ida-close`, `ida-lookup`, `call` in the shell.
Not needed for the opencode tools.

## Targeting a specific instance

`ida_mcp_call` accepts a `target`:

```
{ "port": 13337 }       → exact port
{ "binary": "test.exe" }   → substring match on binary or idb name
{ }                     → auto if exactly one instance, otherwise error with the list
```

## Test

Restart opencode, then in chat:

1. `ida_mcp_instances` — should list any live IDA.
2. `ida_mcp_open` with any `*.so` → new port appears (13337).
3. `ida_mcp_instances` — confirms the new instance.
4. `ida_mcp_tools` — full catalog of IDA tools with parameters.
5. `ida_mcp_call` → `tool: "decompile"`, `args: {"queries":["sub_10"]}`.
6. `ida_mcp_close` → `port: 13337, save: true` → idb saved, PID killed.
7. `ida_mcp_instances` — should be empty.

Syntax check without opencode:

```bash
node --check mcp-ida.js
node --check tool/ida_mcp.js
```
The two usual errors are:

- `Cannot find module '@opencode-ai/plugin'` → run `npm install`.
- `Cannot use import statement outside a module` → add `"type": "module"`.

## Notes

- **Plugin contract (v1):** `export default { id: 'mcp-ida', server: serverFn }`.
  `serverFn` returns only the `config` hook and does no network awaits — an awaited
  `client.config.get()` at startup causes `fetch failed` and a black screen.
- **Tool args are plain objects** — not functions, not zod schemas. Passing a function
  silently drops the tool.
- **Tool directory** is scanned as `{tool,tools}/*.{js,ts}` inside the config dir.