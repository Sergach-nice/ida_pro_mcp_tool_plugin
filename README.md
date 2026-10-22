# opencode (V2) + IDA Pro MCP — Plugin/Tools

Lets the opencode AI agent control IDA Pro over MCP (ida-pro-mcp):
open binaries headless, call IDA tools (`decompile`, `lookup_funcs`,
`xrefs`, `py_eval`, …), close instances — **without restarting opencode**.
The agent sees live instances (ports 13337+) on every call.

## Directory contents

```
mcp-ida.js        opencode plugin (file://) — dynamically registers
                  live instances as remote MCP servers at startup
tool/ida_mcp.js   tool file — 5 native tools (main one)
readme-rus        this file (Russian original)
package.json      dependencies
```

## Tool names visible to the agent

| Tool | Purpose |
|---|---|
| `ida_mcp_instances` | List live instances (port, binary, tools, idb) |
| `ida_mcp_tools` | Full catalog of IDA tools with parameters (`tools/list`) |
| `ida_mcp_call` | Call an IDA tool: `{target, tool, args}` |
| `ida_mcp_open` | Open a binary in IDA headless (`ida.exe -A -p <file>`) |
| `ida_mcp_close` | Close an instance: `idb_save` + `qexit` + `kill pid` |

## 1. Requirements

- opencode (desktop) installed.
- IDA Pro with the ida-pro-mcp plugin (Hex-Rays/ida-pro-mcp). The plugin starts
  an HTTP MCP on 127.0.0.1 on ports 13337, 13338, 13339, … (each running
  IDA gets the next free port from 13337–13356).
- Instance files live at: `%APPDATA%\Hex-Rays\IDA Pro\mcp\instances\instance_<port>.json`

  Contents: `{ "pid": N, "port": N, "binary": "so", "idb_path": "..." }`

## 2. Setup (3 files + an edit of opencode.json)

All `<opencode>` paths = `C:\Users\<user>\.config\opencode\`

### Step 1. Copy the plugin

```
mcp-ida.js  →  <opencode>\plugins\mcp-ida.js
```

### Step 2. Create the tool directory and copy the tool file

```
mkdir <opencode>\tool
tool\ida_mcp.js  →  <opencode>\tool\ida_mcp.js
```

> **IMPORTANT:** the filename is the tools "prefix". The file `ida_mcp.js`
> produces the names
> `ida_mcp_instances` / `ida_mcp_tools` / `ida_mcp_call` / `ida_mcp_open` /
> `ida_mcp_close`
> (convention: `{file_name}_{export_name}`).
> The exports inside the file are: `instances`, `tools`, `call`, `open`, `close`.

### Step 3. Copy the dependencies

```
package.json  →  <opencode>\package.json
```

### Step 4. Path to ida.exe inside tool\ida_mcp.js

Change the `IDA_EXE` line to your path, **or** set the `IDA_EXE`
environment variable:

```js
const IDA_EXE = process.env.IDA_EXE || 'X:\\<full path>\\ida.exe'
```

## 3. Arbitrary ports without restart

The tool file rescans `127.0.0.1:13337…13356` on **every call**
(`rpc tools/list` + `server_health`). Therefore:

- Open a new IDA → it becomes immediately visible to the agent (new port).
- Close an IDA → it disappears immediately.
- **No opencode restart needed.**

### How to target an instance

`ida_mcp_call` → `target`:

```
{ "port": 13337 }         — exactly by port
{ "binary": "test.exe" }  — by substring of binary/idb name
{ }                       — auto: the single instance, otherwise a hint/error
```

## 4. Test (after install)

Restart opencode, then ask the agent in chat to:

1. `ida_mcp_instances`
2. "Open any `*.so` in IDA" (`ida_mcp_open`)
3. `ida_mcp_instances` (port 13337 should appear)
4. `ida_mcp_tools` (full list of tools with parameters)
5. "Decompile function 0x400" (`ida_mcp_call` → `decompile`)
6. `ida_mcp_close 13337 save` (with `.i64` save)
7. `ida_mcp_instances` (empty)

Quick node syntax check (without opencode) that the names are valid:

```bash
node --check <file>.mjs
```

(with node, `.js` without `"type":"module"` is treated as ESM after re-parse)
