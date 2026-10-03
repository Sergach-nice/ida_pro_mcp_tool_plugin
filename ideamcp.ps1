$script:idaMcp:IdaExe = 'ida.exe'

function Invoke-McpRequest {
  param([int]$Port, [string]$Method, $P, [int]$TimeoutSec = 30)
  $body = @{ jsonrpc = '2.0'; id = 1; method = $Method }
  if ($null -ne $P) { $body['params'] = $P }
  $raw = $body | ConvertTo-Json -Depth 12 -Compress
  $req = [Net.HttpWebRequest]::Create("http://127.0.0.1:$Port/mcp")
  $req.Method = 'POST'
  $req.ContentType = 'application/json'
  $req.Timeout = $TimeoutSec * 1000
  $req.ReadWriteTimeout = $TimeoutSec * 1000
  $ms = [Text.Encoding]::UTF8.GetBytes($raw)
  $st = $req.GetRequestStream()
  $st.Write($ms, 0, $ms.Length)
  $st.Close()
  $resp = $req.GetResponse()
  $sr = New-Object IO.StreamReader($resp.GetResponseStream())
  $txt = $sr.ReadToEnd()
  $sr.Close()
  $resp.Close()
  return $txt
}

function ida-ports {
  param([switch]$Quiet, [switch]$Json, [int[]]$Extra)
  $ports = 13337..13352
  if ($Extra) { $ports = @($ports | Where-Object { $Extra -notcontains $_ }) + $Extra }
  $res = @()
  foreach ($p in $ports) {
    $r = @{ port = $p; up = $false; binary = $null; idb = $null }
    try {
      $txt = Invoke-McpRequest -Port $p -Method 'tools/list' -TimeoutSec 2
      $j = $txt | ConvertFrom-Json
      if ($j.result -and $j.result.tools) {
        $r.up = $true
        try {
          $txt2 = Invoke-McpRequest -Port $p -Method 'tools/call' `
            -P @{ name = 'server_health'; arguments = @{} } -TimeoutSec 5
          ($txt2 | ConvertFrom-Json).result.content[0].text | ConvertFrom-Json | ForEach-Object {
            $r.binary = $_.module
            $r.idb = $_.idb_path
          }
        } catch { }
      }
    } catch { }
    $res += $r
  }
  $up = @($res | Where-Object { $_.up })
  $null = @($up | ForEach-Object { $_.port }) | Set-Content -Path "$env:USERPROFILE\.config\opencode\ida-mcp-ports.json" -Encoding Ascii
  if ($Quiet) { return $up }
  if ($up.Count -eq 0) { return 'no IDA MCP instances open' }
  foreach ($u in $up) {
    "port=$($u.port)  $($u.binary)  <-  $($u.idb)"
  }
}

function call {
  param([string]$Tool, [string]$ArgsJson = '{}', [int]$Port, [string]$Idb)
  if ($Port -eq 0) {
    $targets = @()
    if ($Idb) {
      $targets = @(ida-ports -Quiet | Where-Object { $_.idb -like "*$Idb*" -or $_.binary -like "*$Idb*" })
      if ($targets.Count -eq 0) { return "no MCP instance matches '$Idb'" }
    } else {
      $targets = @(ida-ports -Quiet)
      if ($targets.Count -eq 0) { return 'no MCP instances open' }
      if ($targets.Count -gt 1) {
        return ("choose port or idb among: " + (($targets | ForEach-Object { "p$($_.port)/$($_.idb)" }) -join ' , '))
      }
    }
    $Port = $targets[0].port
  }
  $argsObj = if ($ArgsJson -and $ArgsJson -ne '{}') { $ArgsJson | ConvertFrom-Json } else { @{} }
  $body = @{ jsonrpc='2.0'; id=1; method='tools/call';
             params=@{ name=$Tool; arguments=$argsObj } } | ConvertTo-Json -Depth 12 -Compress
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/mcp" -Method POST -Body $body `
    -ContentType 'application/json' -UseBasicParsing -TimeoutSec 900
  $j = $r.Content | ConvertFrom-Json
  $c = $j.result.content
  if ($c -and $c[0].text) { return $c[0].text }
  return $r.Content
}

function ida-open {
  param([Parameter(Mandatory)][string]$File, [switch]$CloseOld)
  $before = @(ida-ports -Quiet | ForEach-Object { $_.port })
  if ($CloseOld) {
    foreach ($p in $before) {
      try { $null = Invoke-McpRequest -Port $p -Method 'tools/call'
            -P @{ name='idb_save'; arguments=@{} } -TimeoutSec 30 } catch { }
      try { $null = Invoke-McpRequest -Port $p -Method 'tools/call'
            -P @{ name='server_health'; arguments=@{action='close'} } -TimeoutSec 15 } catch { }
    }
    Start-Sleep -Seconds 4
    $before = @()
  }
  Start-Process -FilePath $script:idaMcp:IdaExe -ArgumentList '-A', '-p', $File
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 4
    $now = @(ida-ports -Quiet | ForEach-Object { $_.port })
    $new = @($now | Where-Object { $before -notcontains $_ })
    if ($new.Count -gt 0) {
      return "IDA opened: $File  MCP port=$($new[0])"
    }
  }
  return "IDA started for $File but no new MCP port within 120s - check IDA window"
}

function ida-lookup {
  param([string[]]$Names, [int]$Port, [string]$Idb)
  return (call -Tool 'lookup_funcs' -Port $Port -Idb $Idb -ArgsJson ("[`"" + ($Names -join '","') + "`"]"))
}

function ida-close {
  param([Parameter(Mandatory)][int]$Port, [switch]$Save)
  if ($Save) {
    try {
      $null = Invoke-McpRequest -Port $Port -Method 'tools/call'
           -P @{ name='idb_save'; arguments=@{} } -TimeoutSec 30
      "idb saved"
    } catch { "save error: $($_.Exception.Message)" }
  }
  try {
    $null = Invoke-McpRequest -Port $Port -Method 'tools/call'
         -P @{ name='py_eval'; arguments=@{ code='import ida_kernwin; ida_kernwin.qexit()' } } -TimeoutSec 2
  } catch { }
  $pids = @()
  Get-ChildItem "$env:APPDATA\Hex-Rays\IDA Pro\mcp\instances\instance_$Port.json" -ErrorAction SilentlyContinue |
    ForEach-Object {
      $j = (Get-Content $_.FullName -Raw) | ConvertFrom-Json
      if ($j.pid) { $pids += $j.pid }
    }
  foreach ($pid_ in $pids) {
    try { Stop-Process -Id $pid_ -Force -ErrorAction Stop; "killed IDA pid $pid_" }
    catch { "pid $pid_ already gone" }
  }
  $f = "$env:APPDATA\Hex-Rays\IDA Pro\mcp\instances\instance_$Port.json"
  Remove-Item $f -ErrorAction SilentlyContinue
  return "port $Port closed"
}

