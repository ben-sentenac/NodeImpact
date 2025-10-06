```typescript
class PidResolver {
  - options: ResolverOptions
  - platform: PlatformAdapter
  - logger: Logger
  + constructor(options: ResolverOptions)
  + resolve(): Promise<ResolveResult>         // 1 PID
  + resolveAll(): Promise<ResolveAllResult>   // 0..n PIDs (diagnostic)
  - #resolveFromFile(): Promise<Candidate[]>
  - #resolveFromCommand(): Promise<Candidate[]>
  - #resolveFromPort(): Promise<Candidate[]>
  - #applyConstraints(cands: Candidate[]): Promise<Candidate[]>
  - #disambiguate(cands: Candidate[]): Promise<ResolveResult>
  - #strictVerify(cand: Candidate): Promise<boolean>
}

interface PlatformAdapter {
  psInfo(pid: number, timeoutMs: number): Promise<ProcInfo | null>
  findByCommand(pattern: string, fullCmd: boolean, timeoutMs: number): Promise<number[]>
  findByPort(port: number, prefer?: "lsof"|"ss"|"netstat", timeoutMs: number): Promise<number[]>
  isAlive(pid: number): boolean
}

class PosixAdapter implements PlatformAdapter { ... }
class WindowsAdapter implements PlatformAdapter { ... }   // (optionnel / futur)

type ResolverOptions = {
  strategy: "file" | "command" | "port",
  file?: { path: string },
  command?: { pattern: string, fullCmd?: boolean },
  port?: { port: number, prefer?: "lsof"|"ss"|"netstat" },
  constraints?: { name?: string, cmdRegex?: RegExp|string, user?: string },
  strict?: boolean | { delayMs?: number },
  ensureUnique?: boolean | { scope?: "name"|"cmd"|"user" },
  timeoutMs?: number,
  returnInfo?: boolean,
  logger?: Logger | false
}

type Candidate = { pid: number, info?: ProcInfo }
type ProcInfo = { pid: number, user: string, comm: string, args: string }
type ResolveResult = { ok: true, pid: number, info?: ProcInfo } | { ok: false, code: string, message: string, details?: any }
type ResolveAllResult = { ok: true, pids: number[], candidates: Candidate[] } | ResolveResult

interface Logger { debug(...a:any[]): void; info(...a:any[]): void; warn(...a:any[]): void; error(...a:any[]): void }
```
