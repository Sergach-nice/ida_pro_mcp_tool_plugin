// opencode tool file -> ~/.config/opencode/tool/ida_mcp.js
// Final tool ids = {filename}_{exportName} => ida_mcp_instances / _tools / _call / _open / _close
import http from 'node:http'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const ROAMING = process.env.APPDATA
  || (process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Roaming')
    : path.join(os.homedir(), '.config'))
const IDA_EXE = process.env.IDA_EXE || 'ida.exe'
const INST_DIR = path.join(ROAMING, 'Hex-Rays', 'IDA Pro', 'mcp', 'instances')
const MARK = path.join(os.homedir(), '.config', 'opencode', 'ida-tool-mark.txt')
const PORT_START = 13337
const PORT_RANGE = 20

function mark(line) {
  try { fs.appendFileSync(MARK, `[${new Date().toISOString()}] ${line}\n`) } catch {}
}

function rpc(port, method, params, ms = 2500) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? {} })
    const req = http.request(
      { host: '127.0.0.1', port, path: '/mcp', method: 'POST',
        headers: { 'Content-Type': 'application/json' }, timeout: ms },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve(null) } })
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

function pick(instances, t) {
  if (t.port) return instances.find((x) => x.port === t.port)
  if (t.binary) {
    return instances.find((x) => x.binary.includes(t.binary) || (x.idb || '').toLowerCase().includes(String(t.binary).toLowerCase()))
  }
  if (instances.length === 1) return instances[0]
  return null
}

function instancePid(port) {
  try { return JSON.parse(fs.readFileSync(path.join(INST_DIR, `instance_${port}.json`), 'utf8')).pid || null } catch { return null }
}
function removeInstanceFile(port) {
  try { fs.unlinkSync(path.join(INST_DIR, `instance_${port}.json`)) } catch {}
}

// Run a PowerShell script via native args (correct quoting for paths with spaces).
function runPs1(script) {
  const ps1Path = path.join(os.homedir(), '.config', 'opencode', 'ideamcp.ps1')
  const cmd = `. ${JSON.stringify(ps1Path)}; ${script}`
  return new Promise((resolve) => {
    const exe = process.platform === 'win32' ? 'powershell' : 'pwsh'
    const argv = ['-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass', '-Command', cmd]
    let child
    try { child = spawn(exe, argv, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }) }
    catch (e) { resolve(`ps1 spawn error: ${e.message}`); return }
    let o = ''
    child.stdout.on('data', (d) => (o += d))
    child.stderr.on('data', (d) => (o += d))
    child.on('error', (e) => resolve(`ps1 spawn error: ${e.message}`))
    child.on('close', (code) => resolve(`[exit=${code}] ${o.trim()}`.trim()))
  })
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
  const fresh = await wait(liveInstances, (x) => !beforePorts.includes(x.port), 120000)
  if (!fresh.length) return `IDA started for ${file} but no new MCP port within 120s`
  return `IDA opened: ${file}  MCP port=${fresh[0].port}  ${fresh[0].binary}`
}

async function closeInstance(port, save) {
  const lines = []
  // 1) save via MCP (path quoting is irrelevant - JSON-RPC, not shell)
  if (save) {
    try {
      const r = await rpc(port, 'tools/call', { name: 'idb_save', arguments: {} }, 30000)
      const t = r?.result?.content?.[0]?.text
      lines.push(t ? 'saved: ' + t.trim() : 'idb_save (no text)')
    } catch { lines.push('idb_save error') }
  }
  // 2) graceful qexit via MCP
  try { await rpc(port, 'tools/call', { name: 'py_eval', arguments: { code: 'import ida_kernwin; ida_kernwin.qexit()' } }, 2000) } catch {}
  // 3) hard fallback: kill the IDA pid and remove its instance file
  const pid = instancePid(port)
  if (pid) { try { process.kill(pid, 'SIGKILL'); lines.push(`killed pid ${pid}`) } catch (e) { lines.push(`kill ${pid}: ${e.message}`) } }
  removeInstanceFile(port)
  lines.push(`port ${port} closed`)
  return lines.join('\n')
}

export const instances = {
  description: 'Live list of running ida-pro-mcp instances: port, loaded binary, idb path. No restart needed; probes 13337-13356 per call.',
  args: {},
  async execute() {
    const list = await liveInstances()
    if (!list.length) return { title: '0 instances', output: 'no ida-pro-mcp instance listening' }
    return { title: `${list.length} instance(s)`,
      output: list.map((x) => `port=${x.port}  ${x.binary}  tools=${x.tools}  idb=${x.idb || '?'}`).join('\n') }
  },
}

export const call = {
  description: 'Call any ida-pro-mcp tool on a running IDA instance over HTTP (~100 tools: decompile, lookup_funcs, xrefs_to, py_eval, ...). FIRST run ida_mcp_tools to see the full tool catalog with params. target={port} or {binary} or {} (auto if unique). tool=name. args=JSON object string of its params, e.g. {"queries":["sub_10"]}.',
  args: {
    target: { type: 'object', properties: { port: { type: 'number' }, binary: { type: 'string' } } },
    tool: { type: 'string' },
    args: { type: 'string' },
  },
  async execute(a) {
    const t = a.target ?? {}
    const list = await liveInstances()
    if (!list.length) return { title: 'error', output: 'no ida-pro-mcp instance listening' }
    let inst = pick(list, t)
    if (!inst) {
      if (Object.keys(t).length) return { title: 'error', output: `no instance matches ${JSON.stringify(t)}; have: ` + list.map((x) => `p${x.port}/${x.binary}`).join(', ') }
      if (list.length > 1) return { title: 'ambiguous', output: 'multiple instances - pass target {port} or {binary}: ' + list.map((x) => `p${x.port}/${x.binary}`).join(', ') }
    }
    inst = inst || list[0]
    let ta = {}
    if (a.args) try { ta = JSON.parse(a.args) || {} } catch { ta = a.args }
    const params = { name: a.tool, arguments: ta }
    const r = await rpc(inst.port, 'tools/call', params, 60000)
    if (r?.result?.isError) return { title: `error (p${inst.port})`, output: JSON.stringify(r.result.content) + '\n  SENT_BODY: ' + JSON.stringify({ params }) }
    const c = r?.result?.content?.[0]?.text
    return { title: `${a.tool} @ p${inst.port} ${inst.binary}`, output: c ?? JSON.stringify(r) }
  },
}

export const tools = {
  description: 'Full catalog of IDA tools available on a live instance: name(params) - one-line description. target={port} or {binary} or {} (auto if unique). Call this first when unsure which tool or args to use with ida_mcp_call.',
  args: {
    target: { type: 'object', properties: { port: { type: 'number' }, binary: { type: 'string' } } },
  },
  async execute(a) {
    const t = a.target ?? {}
    const list = await liveInstances()
    if (!list.length) return { title: 'error', output: 'no ida-pro-mcp instance listening' }
    let inst = pick(list, t)
    if (!inst) {
      if (Object.keys(t).length) return { title: 'error', output: `no instance matches ${JSON.stringify(t)}; have: ` + list.map((x) => `p${x.port}/${x.binary}`).join(', ') }
      if (list.length > 1) return { title: 'ambiguous', output: 'multiple instances - pass target {port} or {binary}: ' + list.map((x) => `p${x.port}/${x.binary}`).join(', ') }
    }
    inst = inst || list[0]
    const r = await rpc(inst.port, 'tools/list', {}, 5000)
    const tools = r?.result?.tools ?? []
    if (!tools.length) return { title: `error (p${inst.port})`, output: 'tools/list returned no tools' }
    const lines = tools.map((x) => {
      const props = x.inputSchema?.properties ?? {}
      const req = x.inputSchema?.required ?? []
      const params = Object.keys(props).map((k) => (req.includes(k) ? k : k + '?')).join(', ')
      const d = (x.description || '').split('\n')[0]
      return `${x.name}(${params}) - ${d}`
    })
    return { title: `${tools.length} tools @ p${inst.port} ${inst.binary}`, output: lines.join('\n') }
  },
}

export const open = {
  description: 'Launch IDA Pro headless (ida.exe -A -p <file>). closeOld=true (default) saves+closes existing instances so the new one gets port 13337. Waits up to 120s for the MCP port and returns it.',
  args: {
    file: { type: 'string' },
    closeOld: { type: 'boolean' },
  },
  async execute(a) {
    try { return { title: 'ida opened', output: await openIda(a.file, a.closeOld !== false) } }
    catch (e) { return { title: 'ida open error', output: String(e) } }
  },
}

export const close = {
  description: 'Close one IDA MCP instance: idb_save (save default true), qexit, kill pid, remove instance file. port required.',
  args: {
    port: { type: 'number' },
    save: { type: 'boolean' },
  },
  async execute(a) {
    const list = await liveInstances()
    if (!list.some((x) => x.port === a.port)) return { title: 'not found', output: `no live instance on port ${a.port}; see ida_mcp_instances` }
    return { title: 'closed', output: await closeInstance(a.port, a.save !== false) }
  },
}

mark('tool module loaded')
