import { readFile } from 'node:fs/promises';
const STAT_FIELDS_NAME = [
    'pid', 'comm', 'state', 'ppid', 'pgrp', 'session', 'tty_nr', 'tpgid', 'flags',
    'minflt', 'cminflt', 'majflt', 'cmajflt', 'utime', 'stime', 'cutime', 'cstime',
    'priority', 'nice', 'num_threads', 'itrealvalue', 'starttime', 'vsize', 'rss',
    'rsslim', 'startcode', 'endcode', 'startstack', 'kstkesp', 'kstkeip', 'signal',
    'blocked', 'sigignore', 'sigcatch', 'wchan', 'nswap', 'cnswap', 'exit_signal',
    'processor', 'rt_priority', 'policy', 'delayacct_blkio_ticks', 'guest_time',
    'cguest_time', 'start_data', 'end_data', 'start_brk', 'arg_start', 'arg_end',
    'env_start', 'env_end', 'exit_code'
]
class PIDResolver {
    //todo
}

export default class PidCpuReader {
    constructor({ pid, hz = 100, statPath = null }) {
        if (!pid) throw new Error('pid is required');
        this.hz = hz;
        this.state = {
            pid: Number(pid),
            last_app_ticks: null,//total de ticks CPU du process au dernier tick (utime + stime).
            last_start_time: null,//starttime du process au dernier tick (sert à détecter un redémarrage).
            primed: false, // premier passage
        };
        if (statPath) {
            const match = statPath.match(/\/proc\/(\d+)\/stat$/);
            if (match && Number(match[1]) !== this.state.pid) {
                throw new Error(`Mismatch between pid (${this.state.pid}) and statPath (${statPath})`);
            }
        }
        this.pidFile = statPath || `/proc/${this.state.pid}/stat`;
        console.log(this.pidFile);
    }



    async #parse() {
        try {
            let statContent = await readFile(this.pidFile, 'utf8');

            const firstParenthesis = statContent.indexOf('(');
            const lastParenthesis = statContent.lastIndexOf(')');

            statContent = statContent.trim();

            //comm peut contenir des espaces
            //avant la première paran c'est pid
            const pid = Number(statContent.slice(0, firstParenthesis).trim());
            //avant la dernièrec'est comm
            const comm = statContent.slice(firstParenthesis + 1, lastParenthesis).trim();
            const rest = statContent.slice(lastParenthesis + 1).trim();

            const pidStat = {
                pid,
                comm
            };

            const fields = STAT_FIELDS_NAME.slice(2);
            const values = rest.split(/\s+/);

            //TODO check if any nan , if return {ok :false:error:'nan_fields'}

            for (let i = 0; i < fields.length; i++) {
                if (i === 0) {
                    pidStat[fields[i]] = values[i];
                } else {
                    pidStat[fields[i]] = Math.abs(Number(values[i])) > Number.MAX_SAFE_INTEGER ? BigInt(values[i]) : Number(values[i]);
                }

            }
            return {
                ok: true,
                ...pidStat
            };

        } catch (error) {
            return {
                ok: false,
                error:{
                    code:error?.code ?? 'UNKNOWN_ERROR',
                    message:error?.message ?? String(error)
                }
            }
        }
    }

    async getPidStat() {
        return await this.#parse(this.pidFile);
    }

    /**
     * 52711 (node) S 52710 52711 52710 34819 52711 4194560 18391 0 1 0 630 370 0 0 20 0 11 0 9954766 1278586880 17245 18446744073709551615 1 1 0 0 0 0 0 16781312 134235650 0 0 0 17 1 0 0 0 0 0 0 0 0 0 0 0 0 0
     */

    async sample() {

        const timestamp = new Date().toISOString();

        const pidStat = await this.#parse(this.pidFile);


        if (!pidStat.ok) {
            return {
                ok: false,
                pid: this.state.pid,
                app_cpu_s: 0,
                pid_restarted: false,
                ticks: { now: 0, delta: 0 },
                error: pidStat.error,
                timestamp
            }
        }

        const { pid, utime, stime, starttime } = pidStat;
        const app_ticks_now = utime + stime;


        //premiere lecture/redemarage
        if (!this.state.primed) {
            this.state.last_app_ticks = app_ticks_now;
            this.state.last_start_time = starttime;
            this.state.primed = true;
            return {
                ok: true,
                pid,
                app_cpu_s: 0,
                pid_restarted: false,
                ticks: { now: app_ticks_now, delta: 0 },
                timestamp
            }
        }

        //redemarage detecté

        if (starttime !== this.state.last_start_time) {
            this.state.last_app_ticks = app_ticks_now;
            this.state.last_start_time = starttime;
            return {
                ok: true,
                pid,
                app_cpu_s: 0,
                pid_restarted: true,
                ticks: { now: app_ticks_now, delta: 0 },
                timestamp: ts
            }
        }

        let delta_app_ticks = app_ticks_now - this.state.last_app_ticks;

        if (delta_app_ticks < 0) delta_app_ticks = 0;
        const app_cpu_seconds = delta_app_ticks / this.hz;

        this.state.last_app_ticks = app_ticks_now;
        this.state.last_start_time = starttime;

        return {
            ok: true,
            pid,
            app_cpu_s, // ΔCPU de l’app sur l’intervalle (en secondes),
            pid_restarted:false,     // true si starttime a changé sur ce tick
            ticks: {
                now: this.state.last_app_ticks,
                delta: delta_app_ticks  //delta_app_ticks (debug)
            },
            timestamp
        };

    }
}

const reader = new PidCpuReader({pid:25041});


setInterval(async () => {
    console.log(await reader.sample());
},3000);

