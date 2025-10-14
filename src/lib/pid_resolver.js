import { readFile } from "fs/promises";
import { promisify } from "util";
import { execFile } from "child_process";
import { freezeDepth1 } from "./utils.js";
import { createLogger } from "./logger.js";

const execFileAsync = promisify(execFile);


const REGEX = {
    splitPidUserCmdArgs: /^(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/
}

export const ERROR_MESSAGES = Object.freeze({
  // Fichier PID / stratégie file
  invalid_file_options: 'Invalid file options: expected { file: { path: string } }',
  no_pid_found: 'No PID found in file',
  invalid_pid_in_file: 'Invalid PID in file',
  file_read_error: 'Failed to read PID file',

  // Vivacité / infos process
  pid_not_alive: 'PID is not alive',
  process_info_not_found: 'Could not fetch process info (ps returned nothing)',

  // Contraintes
  constraint_name_mismatch: 'Process name (comm) does not match the expected name',
  constraint_cmd_mismatch: 'Process args do not match the expected pattern',
  constraint_user_mismatch: 'Process user does not match the expected user',

  // Mode strict
  strict_verification_failed: 'Strict verification failed on second check',
  strict_identity_changed: 'Process identity (user/comm/args) changed between checks',

  // Stratégies non implémentées
  not_implemented: 'Strategy not implemented',

  // Exécutions de commandes (runCmd)
  tool_unavailable: 'Command not found',
  cmd_timeout: 'Command timed out',
  cmd_exit: 'Command exited with non-zero code',
  cmd_failed: 'Command failed',

  // Stratégie command
  invalid_command_options: 'Invalid command options: expected { command: { pattern } }',
  no_match: 'No process matched the given command pattern',
  multiple_matches: 'Multiple processes matched the pattern',

  // (Optionnels / futurs)
  invalid_port_options: 'Invalid port options: expected { port: { port: number } }',
  invalid_env_options: 'Invalid env options: expected { env: { var: string } }',
});

Object.freeze(ERROR_MESSAGES);

const STRATEGIES = new Set(['file', 'env', 'command', 'port']);
const DEFAULT = Object.freeze({ timeoutMs: 5000, strictDelayMs: 150 });

//helpers 

export function deepFreeze(obj) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
        Object.freeze(obj);
        for (const key of Object.keys(obj)) {
            deepFreeze(obj[key]);
        }
    }
    return obj;
}

export function sleep(delayMs) {
    return new Promise(res => setTimeout(res, delayMs));
}

function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        if (e.code === 'ESRCH') {
            return false; // n'existe pas
        } else if (e.code === 'EPERM') {
            return true;  // existe mais pas les droits
        } else
            throw e; // autre erreur
    }
}

export async function runCmd(command, args = [], { timeoutMs } = {}, log) {
    log?.debug('cmd.start', { command, args, timeoutMs });
    try {
        const { stdout = '', stderr = '' } = await execFileAsync(command, args, { timeout: timeoutMs });
        log?.debug('cmd.ok', { command, stdoutLen: String(stdout).length, stderrLen: String(stderr).length });
        return { ok: true, stdout: String(stdout), stderr: String(stderr) };
    } catch (e) {
        if (e?.code === 'ENOENT') {
            log?.error('cmd.fail', { command, reason: 'ENOENT' });
            return { ok: false, error: 'tool_unavailable', message: ERROR_MESSAGES.tool_unavailable, details: { command } };
        }
        if (e?.killed || e?.signal === 'SIGTERM' || e?.code === 'ETIMEDOUT') {
            log?.error('cmd.fail', { command, reason: 'timeout' });
            return { ok: false, error: 'cmd_timeout', message: ERROR_MESSAGES.cmd_timeout, details: { command, timeoutMs } };
        }
        if (typeof e?.code === 'number') {
            log?.error('cmd.fail', { command, reason: 'exit', code: e.code });
            return { ok: false, error: 'cmd_exit', message: ERROR_MESSAGES.cmd_exit, details: { command, code: e.code, stderr: String(e?.stderr || '') } };
        }
        log?.error('cmd.fail', { command, reason: 'unknown' });
        return { ok: false, error: 'cmd_failed', message: ERROR_MESSAGES.cmd_failed, details: { command, message: e?.message } };
    }
}

export async function listProcesses(timeoutMs,log = null) {
    log ? log.debug('start.listing.process'): null;
    const response = await runCmd('ps', ['-eo', 'pid=,user=,comm=,args='], { timeoutMs });
    if (!response.ok) return [];
    const stdout = response.stdout.split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const match = line.match(REGEX.splitPidUserCmdArgs)
            if (!match) return null;
            const [, pid, user, comm, args] = match;
            return {
                pid: Number(pid),
                user,
                comm,
                args
            };
        });
    return stdout.filter(Boolean);
}

function buildMatcher(command) {
    const { pattern, fullCommand, caseSensitive } = command;
    if (pattern instanceof RegExp) {
        return (p) => fullCommand ? pattern.test(p.args) : pattern.test(p.comm);
    }
    const needle = String(pattern);
    const convertToLower = (n) => caseSensitive ? n : n.toLowerCase();
    return (p) => {
        const commands = convertToLower(fullCommand ? p.args : p.comm);
        return commands.includes(convertToLower(needle), 0);
    }
}

async function getProcessInfo(pid, timeoutMs, log) {
    // TODO:
    // utiliser ps
    // ps -o user=,comm=,args= -p <pid>
    try {
        const res = await runCmd('ps', ['-o', 'user=,comm=,args=', '-p', String(pid)], { timeoutMs }, log);
        if (!res.ok) return null;
        const psInfo = parsePsLine(res.stdout);
        return psInfo ? { pid: Number(pid), ...psInfo } : null;
    } catch (error) {
        return null;
    }
}

function parsePsLine(lines) {
    const lineArray = lines.trim().split('\n')[0];
    if (!lineArray) {
        return null;
    }
    // regex: user (non space) + space + comm (non space) + space + args (reste de la ligne)
    const match = lineArray.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);
    if (!match) return null;
    const [, user, comm, args] = match;
    return { user, comm, args };
}

function err(code, details) {
    return { ok: false, error: code, message: ERROR_MESSAGES[code] || code, ...(details ? { details } : {}) };
}

function ok(payload) {
    return { ok: true, ...payload };
}

function hasConstraints(constraints) {
    return Boolean(constraints && Object.keys(constraints).length > 0);
}

function getStrictDelay(strictOpt) {
    if (strictOpt && typeof strictOpt === 'object' && Number.isFinite(strictOpt.delayMs) && strictOpt.delayMs > 0) {
        return strictOpt.delayMs;
    }
    return strictOpt ? DEFAULT.strictDelayMs : 0;
}

async function readPidFromFile(path) {
    try {
        const content = await readFile(path, 'utf8');
        const match = content.match(/^\s*([1-9]\d*)\s*$/);
        if (!match) {
            return err('no_pid_found', { path });
        }
        const pid = Number(match[1]);
        if (isNaN(pid) || !Number.isInteger(pid) || pid <= 0) {
            return err('invalid_pid_in_file', { path, raw: content.trim() });
        }
        return ok({ pid });
    } catch (error) {
        return err('file_read_error', { path, message: error?.message });
    }
}

function normalizeOptions(options) {
    //  Clone défensif AVANT toute normalisation
    const cloned = structuredClone(options);
    //  Normalisation sur la copie
    if (typeof cloned.file === 'string') {
        cloned.file = { path: cloned.file };
    }
    // validate constraints
    const rawConstraints = (cloned.constraints && typeof cloned.constraints === 'object') ? cloned.constraints : {};
    const cmdRegex = typeof rawConstraints.cmdRegex === 'string'
        ? new RegExp(rawConstraints.cmdRegex)
        : rawConstraints.cmdRegex instanceof RegExp
            ? rawConstraints.cmdRegex
            : undefined;

    return {
        strategy: cloned.strategy,
        file: cloned.file ?? null,
        // strict: Réduire le risque de réutilisation de PID entre la lecture 
        // du fichier et la validation, en revalidant après un léger délai.
        strict: cloned.strict ?? false,
        ensureUnique: cloned.ensureUnique ?? false,
        timeoutMs: (Number.isFinite(cloned.timeoutMs) && cloned.timeoutMs > 0) ? cloned.timeoutMs : DEFAULT.timeoutMs,
        constraints: { ...rawConstraints, ...(cmdRegex ? { cmdRegex } : {}) },
        returnInfo: cloned.returnInfo ?? false,
        command: cloned.command ?? {}
    }
}

export class PIDResolver {
    #options;
    constructor(options = {}) {

        //extraire logger des options car structuredClone ne gere pas les fonctions
        const { logger, logLevel, ..._options } = options ?? {};

        if (!_options.strategy || !STRATEGIES.has(_options.strategy)) {
            throw new Error('Invalid or missing strategy option <strategy>');
        }

        this.#options = normalizeOptions(_options);

        this.log = createLogger(options.logger, logLevel || 'warn');

        Object.freeze(this.#options); // interne figé

    }

    get options() {
        const snap = structuredClone(this.#options);
        // TODO: refactor protectedDeepFreeze
        // add depth options to avoid recursion
        return freezeDepth1(snap); // snapshot figé limité au sous obj evite recursion circulaire du au getter
    }

    async #validateConstraints(pid) {

        const { timeoutMs, constraints } = this.#options;

        if (!hasConstraints(constraints)) return ok({ info: null });

        const psInfos = await getProcessInfo(pid, timeoutMs, this.log);

        if (!psInfos) {
            return err('process_info_not_found', { pid });
        }
        //a partir de node 24 comm = 'mainTrhread' pas 'node'
        if (constraints.name) {
            const expectedName = Array.isArray(constraints.name) ? constraints.name : [constraints.name];
            if (!expectedName.includes(psInfos.comm)) {
                return err('constraint_name_mismatch');
            }
        }

        if (constraints.cmdRegex && !constraints.cmdRegex.test(psInfos.args)) {
            return err('constraint_cmd_mismatch');
        }

        if (constraints.user && psInfos.user !== constraints.user) {
            return err('constraint_user_mismatch');
        }

        return { ok: true, info: psInfos };

    }

    async revalidateConstraintsAtT1(first,pid,constraints) {
        const delayMs = getStrictDelay(this.#options.strict);
        let second = null;
        if (delayMs > 0) {
            await sleep(delayMs);
            if (!hasConstraints(constraints)) {
                if (!isPidAlive(pid)) {
                    this.log.error('strict.fail', { pid, reason: 'notAlive' });
                    return err('strict_verification_failed');
                }
                this.log.debug('strict.ok', { pid });
            } else {
                second = await this.#validateConstraints(pid);
                if (!second.ok) {
                    this.log.error('strict.fail', { pid, reason: second.error });
                    return err('strict_verification_failed', { pid, reason: second.error });
                }
                //on compare first et second
                const a = first.info, b = second.info
                if (!a || !b || a.user !== b.user || a.comm !== b.comm || a.args !== b.args) {
                    this.log.error('strict.changed', { pid });
                    return err('strict_identity_changed');
                }
            }
            this.log.debug('strict.ok', { pid });
        }
        return second;
    }

    async #resolveFromFile() {
        const { file, constraints, returnInfo, timeoutMs } = this.#options;
        this.log.debug('resolve.start', { strategy: 'file' });

        if (!file || typeof file !== 'object' || !file.path || typeof file.path !== 'string') {
            return err('invalid_file_options');
        }
        //1) lire PID
        this.log.debug('file.read.start', { path: file.path });
        const response = await readPidFromFile(file.path);
        if (!response.ok) return response;
        const pid = response.pid;
        this.log.debug('file.read.ok', { path: file.path, pid });

        //2) vivacité
        if (!isPidAlive(pid)) {
            this.log.error('file.liveness.notAlive', { pid });
            return err('pid_not_alive', { pid });
        }
        //3) contraintes t0
        const first = await this.#validateConstraints(pid);
        if (!first.ok) {
            this.log.warn('constraints.fail', { pid, error: first.error });
            return first;
        }
        this.log.debug('constraints.ok', { pid });
        //4) strict t1
        let second = await this.revalidateConstraintsAtT1(first,pid,constraints);
        if (second && second.ok === false) return second;
        if (returnInfo) {
            let info = null;
            if (hasConstraints(constraints)) {
                info = (second && second.info) || first && first.info || await getProcessInfo(pid, timeoutMs, this.log);
            } else {
                info = await getProcessInfo(pid, timeoutMs, this.log);
            }
            return ok({ pid, info })
        }
        return ok({ pid })

    }

    async #resolveFromEnv() {
        return err('not_implemented');
    }

    async #resolveFromCommand() {
        const { timeoutMs, command, ensureUnique, constraints, returnInfo } = this.#options;
        if (!command || !command?.pattern) {
            return err('invalid_command_options', { command })
        }
        if (typeof command.pattern !== 'string' && (!command.pattern) instanceof RegExp) {
            return err('invalid_command_options', { command })
        }
        this.log.debug('resolve.start', { strategy: 'command' });
        const processes = await listProcesses(timeoutMs,this.log);

        const commandToParse = {
            pattern: command.pattern,
            caseSensitive: command.caseSensitive ?? false,
            fullCommand: command.fullCommand ?? false
        }

        const match = buildMatcher(commandToParse);
        const candidates = processes.filter(match);

        if (candidates.length === 0) {
            return err('no_match');
        }

        let selected;
        if (candidates.length > 1) {
            //ensureUnique test
            if (ensureUnique) {
                return err('multiple_matches', { count: candidates.length, pids: candidates.map(p => p.pid) });
            }
            //selectionner le process
            const pick = command.pick ?? 'first';
            if(pick === 'newest') selected = candidates.at(-1);
            else if (pick === 'oldest') selected = candidates[0];
            else selected = candidates[0];
            this.log.warn('command.multiple', { count: candidates.length, picked: selected.pid });
        } else {
            selected = candidates[0];
        }

        if (!isPidAlive(selected.pid)) {
            return err('pid_not_alive', { pid: selected.pid });
        }

        //contrainte t0 
        const first = await this.#validateConstraints(selected.pid);
        if (!first.ok) {
            this.log.warn('constraint.fail', { pid: selected.pid, error: first.error });
            return first;
        }
        this.log.debug('constraints.ok', { pid: selected.pid });
        //strict t1
        let second = await this.revalidateConstraintsAtT1(first,selected.pid,constraints);
        if (second && second.ok === false) return second;
        if (returnInfo) {
            const info = second?.info ?? first?.info ?? await getProcessInfo(selected.pid, timeoutMs, this.log);
            return ok({ pid: selected.pid, info });
        }
        return ok({ pid: selected.pid })
    }

    async #resolveFromPort() {
        return err('not_implemented');
    }

    async resolve() {
        switch (this.#options.strategy) {
            case 'file':
                return await this.#resolveFromFile();
            case 'env':
                return this.#resolveFromEnv();
            case 'command':
                return this.#resolveFromCommand();
            case 'port':
                return this.#resolveFromPort();
            default:
                throw new Error(`Unsupported strategy ${this.#options.strategy}`);
        }
    }
}
