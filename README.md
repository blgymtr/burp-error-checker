# burp-error-checker

Diagnoses the root cause of Burp Suite extensions that fail to load.

## What it does

- Reads the not-loaded extension list from Burp `user_options` (via the MCP channel when Burp is running) or from `%APPDATA%\BurpSuite\UserConfig.json` (when Burp is closed)
- For each failing extension it runs, in order:
  1. **File existence** — does the path stored in the config actually exist on disk
  2. **Jython syntax-only compile** (python extensions) — runs `compile()` only, never executes the extension
  3. **JAR validity** (`jar tf` with a `tar -tf` fallback)
- Writes a Markdown report

## Usage

```bash
node ext-error-diagnose.js
```

Optional environment variables:

| Variable | Meaning |
|---|---|
| `BURP_JYTHON` | path to the jython-standalone JAR (default: `jython-standalone-2.7.4.jar` in the working directory) |
| `DIAGNOSE_OUT` | report output file (default: `ext-error-report.md`) |

## A real-world case this tool covers

Jython 2.7 on Windows cannot `os.chdir()` into a directory whose path contains
non-ASCII characters (e.g. a Turkish `Ö` in the username). If your Windows
profile path contains such characters, **every Python-based Burp extension
fails to load with `PosixModule.chdir` / `OSError(2)`**, while all Java
extensions load fine. Workaround: start Burp with an ASCII-only `%APPDATA%`
path (for example the Windows 8.3 short name of your profile folder).

## Requirements

- Node.js
- Java (for Jython)
- Burp Suite with the extensions installed

## License

MIT
