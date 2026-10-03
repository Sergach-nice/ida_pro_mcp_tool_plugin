// Auto-discovers running ida-pro-mcp HTTP instances (127.0.0.1:13337+)
// and lets the agent call tools on ANY of them at runtime, no restart needed.
import http from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Note: this runs in opencode's Node runtime (NOT Electron) -- no os.appdata().
// Windows %APPDATA% equals %USERPROFILE%\AppData\Roaming, so derive from home.
const ROAMING = process.env.APPDATA
  || (process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Roaming')
    : path.join(os.homedir(), '.config'))
const IDA_EXE = process.env.IDA_EXE || 'ida.exe'
const INST_DIR = path.join(ROAMING, 'Hex-Rays', 'IDA Pro', 'mcp', 'instances')
const MARK = path.join(os.homedir(), '.config', 'opencode', 'mcp-ida-mark.txt')

function mark(line) {
  try { fs.appendFileSync(MARK, `[${new Date().toISOString()}] ${line}\n`) } catch {}
}

mark('module loaded')

const PORT_START = 13337
const PORT_RANGE = 20

function rpc(port, method, params, ms = 2500) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? {} })
    const req = http.request(
      { host: '127.0.0.1', port, path: '/mcp', method: 'POST',
        headers: { 'Content-Type': 'application/json' }, timeout: ms },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try { resolve(JSON.parse(data)) } catch { resolve(null) }
        })
      })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.write(body)
    req.end()
  })
}

async function liveInstances() {
  const out = []
  await Promise.all(
    Array.from({ length: PORT_RANGE }, (_, i) =>
      (async () => {
        const port = PORT_START + i
        const r = await rpc(port, 'tools/list', {}, 600)
        if (r && r.result && r.result.tools) {
          let info = { port, binary: `port_${port}`, idb: null, tools: r.result.tools.length }
          try {
            const h = await rpc(port, 'tools/call', { name: 'server_health', arguments: {} }, 1500)
            const t = h?.result?.content?.[0]?.text
            if (t) {
              const j = JSON.parse(t)
              info.binary = j.module || info.binary
              info.idb = j.idb_path
            }
          } catch {}
          out.push(info)
        }
      })()
    )
  )
  return out.sort((a, b) => a.port - b.port)
}

function pick(instances, args) {
  if (args.port) return instances.find((x) => x.port === args.port)
  if (args.binary) {
    return instances.find((x) => x.binary.includes(args.binary) || (x.idb || '').toLowerCase().includes(String(args.binary).toLowerCase()))
  }
  if (instances.length === 1) return instances[0]
  return null
}

function runPs1(script) {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell',
      ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command',
        `. ${JSON.stringify(path.join(os.homedir(), '.config', 'opencode', 'ideamcp.ps1'))}; ${script}`],
      { windowsHide: true }
    )
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', (e) => resolve(null))
    child.on('close', () => resolve(out.trim() || null))
  })
}

function instancePid(port) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(INST_DIR, `instance_${port}.json`), 'utf8'))
    return j.pid || null
  } catch { return null }
}

function removeInstanceFile(port) {
  try { fs.unlinkSync(path.join(INST_DIR, `instance_${port}.json`)) } catch {}
}

function wait(list, predicate, ms, stepMs = 4000) {
  const t0 = Date.now()
  return new Promise(async (resolve) => {
    for (;;) {
      const l = await list()
      const found = l.filter(predicate)
      if (found.length) return resolve(found)
      if (Date.now() - t0 > ms) return resolve([])
      await new Promise((r) => setTimeout(r, stepMs))
    }
  })
}

async function openIda(file, closeOld) {
  if (!fs.existsSync(IDA_EXE)) throw new Error(`ida.exe not found: ${IDA_EXE}`)
  const before = (await liveInstances()).map((x) => x.port)
  if (closeOld) {
    for (const p of before) {
      try { await rpc(p, 'tools/call', { name: 'idb_save', arguments: {} }, 30000) } catch {}
      const pid = instancePid(p)
      if (pid) { try { process.kill(pid) } catch {} }
      removeInstanceFile(p)
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
  const beforePorts = (await liveInstances()).map((x) => x.port)
  spawn(IDA_EXE, ['-A', '-p', file], { stdio: 'ignore', detached: true, windowsHide: true }).unref()
  const fresh = await wait(
    liveInstances,
    (x) => !beforePorts.includes(x.port),
    120000
  )
  if (!fresh.length) {
    return `IDA started for ${file} but no new MCP port within 120s - check IDA`
  }
  return `IDA opened: ${file}  MCP port=${fresh[0].port}  ${fresh[0].binary}`
}

async function closeInstance(port, save) {
  const out = await runPs1(`ida-close -Port ${port} -Save:$${save ? 'true' : 'false'}`)
  return out || `port ${port} closed`
}

async function serverFn(input) {
  const { client } = input
  return {
    config: async (live) => {
      // Dynamic MCP: register a remote MCP server for every live IDA instance.
      const list = await liveInstances()
      const mcp = (live.mcp ??= {})
      for (const x of list) {
        const name = `ida_${x.binary.replace(/[^A-Za-z0-9_]+/g, '_')}`
        if (!mcp[name]) {
          mcp[name] = { type: 'remote', url: `http://127.0.0.1:${x.port}/mcp`, enabled: true }
        }
      }
      mark('config hook: ' + list.length + ' instance(s) at startup')
      const s = client.server ?? null
      s?.app.log?.({ body: { level: 'info', message: `[mcp-ida] registered ${list.length} instance(s) at startup` } })
      return true
    },
  }
}

// v1 plugin contract (this opencode build): default export is an object
// { id, server(input, options) }. `id` is required for file:// path plugins.
export default {
  id: 'mcp-ida',
  server: serverFn,
}
