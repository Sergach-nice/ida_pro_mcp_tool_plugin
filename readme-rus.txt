================================================================================
opencode + IDA Pro MCP  —  плагин/тулы
================================================================================
Позволяет ИИ-агенту opencode управлять IDA Pro через MCP (ida-pro-mcp):
открывать бинарники headless, вызывать IDA-тулы (decompile, lookup_funcs,
xrefs, py_eval, ...), закрывать инстансы — БЕЗ перезапуска opencode.
Агент видит живые инстансы (порты 13337+) каждым вызовом.

Состав каталога:
    mcp-ida.js        плагин opencode (file://) — динамически регистрирует
                      live-инстансы как remote MCP-серверы при старте
    tool/ida_mcp.js   tool-файл — 5 нативных тулов (главное)
    ideamcp.ps1       PowerShell-хелперы (опциональный fallback)
    readme-rus        этот файл

Имена тулов, которые видит агент:
    ida_mcp_instances   список живых инстансов (порт, бинарник, tools, idb)
    ida_mcp_tools       полный каталог тулов IDA с параметрами (tools/list)
    ida_mcp_call        вызвать тул IDA: {target, tool, args}
    ida_mcp_open        открыть бинарник в IDA headless (ida.exe -A -p <file>)
    ida_mcp_close       закрыть инстанс: idb_save + qexit + kill pid


================================================================================
1. ТРЕБОВАНИЯ
================================================================================
- opencode (desktop) установлен.
  Путь по умолчанию: C:\Users\<user>\AppData\Local\Programs\@opencode-aidesktop\
- IDA Pro с плагинами ida-pro-mcp (Hex-Rays/ida-pro-mcp). Плагин поднимает
  HTTP MCP по 127.0.0.1 на портах 13337, 13338, 13339, ... (каждый запущенный
  IDA получает следующий свободный порт из 13337-13356).
  Инстансы живут: %APPDATA%\Hex-Rays\IDA Pro\mcp\instances\instance_<port>.json
    содержимое: { "pid": N, "port": N, "binary": "so", "idb_path": "..." }
- node (для локальной проверки файлов; сам opencode поднимает их сам).


================================================================================
2. НАСТРОЙКА  (3 файла + правка opencode.json)
================================================================================
Пути в <opencode> = C:\Users\<user>\.config\opencode\


Шаг 1. Скопировать плагин:
    mcp-ida.js  ->  <opencode>\mcp-ida.js

Шаг 2. Создать каталог tool и скопировать tool-файл:
    mkdir <opencode>\tool
    tool\ida_mcp.js  ->  <opencode>\tool\ida_mcp.js
    ВАЖНО: имя файла = "префикс" тулов. Файл ida_mcp.js даёт имена
             ida_mcp_instances / ida_mcp_tools / ida_mcp_call / ida_mcp_open / ida_mcp_close
             (конвенция: {имя_файла}_{имя_экспорта}).
             Экспорты внутри файла: instances, tools, call, open, close.

Шаг 3 (опционально). PowerShell-хелпер:
    ideamcp.ps1  ->  <opencode>\ideamcp.ps1
    И в профиле PowerShell (WindowsPowerShell_profile.ps1) одной строкой:
        . "$HOME\.config\opencode\ideamcp.ps1"
    Даёт в консоли: ida-ports, ida-open, ida-close, ida-lookup, call.
    Не обязателен для работы тулов opencode — close уже идёт чистым MCP.

Шаг 4. Правка <opencode>\opencode.json — добавить ключи "mcp" и "plugin":
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
    - "mcp" — статический сервер порта 13337 (41 tuл вида ida-pro-mcp_*).
      Если IDA на 13337 не открыт — это лишь предупреждение "server
      unavailable", не падение.
    - "plugin" — путь file:// к mcp-ida.js (красивые slashes forward, не back).

Шаг 5. Путь к ida.exe внутри tool-файлов ({tool\ida_mcp.js, ideamcp.ps1, mcp-ida.js}, строка IDA_EXE):
    const IDA_EXE = process.env.IDA_EXE || 'X:\\<full path>\\ida.exe'
    Поменяй на свой путь ЛИБО задай переменную окружения IDA_EXE.


================================================================================
3. ПРОИЗВОЛЬНЫЕ ПОРТЫ БЕЗ ПЕРЕЗАПУСКА
================================================================================
tool-файл при каждом вызове сам сканирует 127.0.0.1:13337..13356
(rpc tools/list + server_health). Поэтому:
  - открыл новый IDA -> он сразу виден агенту (новый порт).
  - закрыл IDA -> сразу исчезает.
  - перезапуск opencode НЕ нужен.

Как указать, на какой инстанс попасть:
  ida_mcp_call target:
     { "port": 13337 }        — точно по порту
     { "binary": "test.exe" }    — по подстроке имени бинарника/idb
     { }                      — авто: единственный инстанс, иначе ошибка-подсказка


================================================================================
5. ЧТО В КАЖДОМ ФАЙЛЕ
================================================================================
mcp-ida.js  (плагин, file://)
  - v1-контракт: export default { id:'mcp-ida', server: serverFn }
  - serverFn возвращает ТОЛЬКО config-хук: на старте находит live-инстансы
    и добавляет в конфиг mcp[id_<binary>] = remote.
  - ВАЖНО: в serverFn НЕ должно быть сетевых await (client.config.get и т.п.) —
    иначе "fetch failed" на старте -> чёрный экран opencode. (Уже учтено.)

tool/ida_mcp.js  (tool-файл, главное)
  - 5 named-экспортов { description, args, execute } -> 5 нативных тулов.
  - args — только plain-объект (НЕ функция, НЕ zod) -> иначе тул молча
    отбрасывается (зod.object(fn) краш). Всё учтено.
  - живёт в <opencode>\tool\ (каталог сканируется: {tool,tools}/*.{js,ts}).

ideamcp.ps1 (опциональный)
  - Invoke-McpRequest (JSON-RPC HTTP), ida-ports, call, ida-open, ida-close,
    ida-lookup. Используется как fallback и вручную в PowerShell.

================================================================================
7. ТЕСТ (после установки)
================================================================================
Перезапустить opencode. В чате попросить агента:
  1) "ida_mcp_instances"
  2) "открой любой *\.so в IDA"  (ida_mcp_open)
  3) "ida_mcp_instances"             (должен появиться порт 13337)
   4) "ida_mcp_tools"                 (полный список тулов с параметрами)
   5) "декомпилируй функцию 0x400"    (ida_mcp_call decompile)
   6) "ida_mcp_close 13337 save"      (с сохранением .i64)
   7) "ida_mcp_instances"             (пусто)

Быстрая проверка node (без opencode), что имена/валидны:
  node --check <файл>.mjs
  (в node .js без "type":"module" воспринимается как ESM по репарсе)

================================================================================
