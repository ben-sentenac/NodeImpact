import { readFile } from "fs/promises";
import { promisify } from "util";
import { execFile } from "child_process";
import { freezeDepth1, shallowFreeze } from "./utils.js";
import { createLogger } from "./logger.js";
import { Console } from "console";

const execFileAsync = promisify(execFile);


const ERROR_MESSAGES = {
    invalid_file_options: 'Invalid file options: expected { file: { path: string } }',
    no_pid_found: 'No PID found in file',
    invalid_pid_in_file: 'Invalid PID in file',
    pid_not_alive: 'PID is not alive',
    process_info_not_found: 'Could not fetch process info (ps returned nothing)',
    constraint_name_mismatch: 'Process name (comm) does not match the expected name',
    constraint_cmd_mismatch: 'Process args do not match the expected pattern',
    constraint_user_mismatch: 'Process user does not match the expected user',
    strict_verification_failed: 'Strict verification failed on second check',
    strict_identity_changed: 'Process identity (user/comm/args) changed between checks',
    file_read_error: 'Failed to read PID file',
    not_implemented: 'Strategy not implemented',
    tool_unavailable: 'Command not found',
    cmd_timeout: 'Command timed out',
    cmd_exit: 'Command exited with non-zero code',
    cmd_failed: 'Command failed',
};

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
        const { stdout = '', stderr = '' } = await execFileAsync(command, args, {timeout:timeoutMs});
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

async function getProcessInfo(pid, timeoutMs,log) {
    // TODO:
    // utiliser ps
    // ps -o user=,comm=,args= -p <pid>
    try {
        const res = await runCmd('ps', ['-o', 'user=,comm=,args=', '-p', String(pid)], { timeout: timeoutMs },log);
        if(!res.ok) return null;
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
    return strictOpt ? 150 : 0;
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
    }
}

export  class PIDResolver {
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

        const psInfos = await getProcessInfo(pid, timeoutMs,this.log);

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


    async #resolveFromFile() {
        const { file, strict, constraints, returnInfo, timeoutMs } = this.#options;
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

        const delayMs = getStrictDelay(strict);
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

        //final
        if (returnInfo) {
            let info = null;
            if (hasConstraints(constraints)) {
                info = (second && second.info) || first && first.info || await getProcessInfo(pid, timeoutMs,this.log);
            } else {
                info = await getProcessInfo(pid, timeoutMs,this.log);
            }
            return ok({ pid, info })
        }
        return ok({ pid })

    }

    async #resolveFromEnv() {
        return err('not_implemented');
    }

    async #resolveFromCommand() {
        return err('not_implemented');
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
