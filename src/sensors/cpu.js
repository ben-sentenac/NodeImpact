import { readFile } from 'node:fs/promises';

/**
 * TODO
 * ΔCPU_host_s : secondes CPU “actives” de l’hôte sur l’intervalle,
 * ΔCPU_app_s : secondes CPU consommées par le PID cible,
 * share = ΔCPU_app_s / ΔCPU_host_s (borné),
 * gérer redémarrage de PID et cas limites.
 */

const FLAG_CATEGORIES = {
    ['virtualization']: ['vmx', 'svm', 'ept', 'npt', 'tpr_shadow', 'vme'],
    ['security']: ['nx', 'smap', 'smep', 'md_clear', 'pti', 'lahf_lm', 'rdtscp'],
    ['crypto']: ['aes', 'rdrand', 'rdseed', 'sha_ni'],
    ['performance']: [
        'sse', 'sse2', 'sse3', 'ssse3', 'sse4_1', 'sse4_2',
        'avx', 'avx2', 'fma', 'mmx', 'pni', 'popcnt',
        'xsave', 'xsaveopt', 'xsavec', 'xsaves'
    ],
    ['management']: ['hwp', 'tsc', 'cpuid', 'clflush', 'invariant_tsc', 'constant_tsc']
};


const CPU_FILES_INFO = {
    cpuInfo: '/proc/cpuinfo',
    stat: '/proc/stat'
};

export default class SystemCpuProfiler {

    constructor({ cpuInfo, stat } = CPU_FILES_INFO) {
        this.cpuFiles = { cpuInfo, stat };
        this.cpus = [];
        this.cpuStatSnapshot = null;
    }

    analyzeFlags(flags) {
        const _flags = flags.split(' ');
        return {
            virtualisable: _flags.includes('vmx') || _flags.includes('svm'),
            aesSupport: _flags.includes('aes'),
            secureBootCapable: _flags.includes('nx') && _flags.includes('smap') && _flags.includes('smep')
        };
    }

    #groupFlags(flagsStr) {
        const flags = flagsStr.split(' ');
        const grouped = {};
        for (const key of Object.keys(FLAG_CATEGORIES)) {
            const set = new Set(FLAG_CATEGORIES[key]);
            grouped[key] = flags.filter(f => set.has(f));
        }
        return grouped;
    }

    async getAllCpusDetails() {
        return await this.#parseCpuInfo();
    }

    getLastSnapshot() {
        return this.cpuStatSnapshot
    }

    async cpuInfo() {
        const cpus = await this.getAllCpusDetails(); //await this.#parseCpuInfo();
        if (!cpus.length) {
            return { ok:false, timestamp: new Date().toISOString(), cpu: null, error: 'cpuinfo_unavailable' };
        }
        const flags = { ...this.analyzeFlags(cpus[0]['flags']) };
        const timestamp = new Date().toISOString();
        const freqMHz = cpus.map(cpu => parseFloat(cpu['cpu_mhz']) || 0).filter(n => Number.isFinite(n));
        const totalFreq = freqMHz.reduce((sum, freq) => sum + freq, 0);
        const maxFreq = freqMHz.length ? Math.max(...freqMHz) : 0;
        const minFreq = freqMHz.length ? Math.min(...freqMHz) : 0;
        const spreadFreq = maxFreq - minFreq;
        const averageFreq = freqMHz.length ? totalFreq / freqMHz.length : 0;
        const logicalCores = parseInt(cpus[0]['siblings'] || '0', 10);
        const physicalCores = parseInt(cpus[0]['cpu_cores'] || '0', 10);
        const cpuLoadEstimate = maxFreq > 0 ? averageFreq / maxFreq : 0;
        const hyperThreading = logicalCores > physicalCores;

        return {
            ok: true,
            timestamp,
            cpu: {
                vendor: cpus[0]['vendor_id'],
                model: cpus[0]['model_name'],
                cores: {
                    physical: physicalCores,
                    logical: logicalCores
                },
                frequency: {
                    unit: 'MHz',
                    total: totalFreq,
                    average: averageFreq,
                    max: maxFreq,
                    min: minFreq,
                    spread: spreadFreq,
                    loadEstimate: cpuLoadEstimate
                },
                cache: cpus[0]['cache_size'],
                powerManagement: cpus[0]['power_management'],
                capabilities: flags,
                hyperThreading
            },
        }
    }
    //100 par default ajouter USR_HZ une détection plus tard
    async stat() {
        try {
            const stats = (await this.#parseStat()).aggregate;
        //unit jiffy (1/100 seconds (10 ms)
        //jiffy est une unité de temps utilisée par le noyau Linux pour mesurer l’activité du système. Sa durée dépend de la configuration du noyau
        //définie par USER_HZ, généralement égale à 100
        //getconf CLK_OK pour tester
        if (!stats || Object.keys(stats).length === 0) {
            return { ok:false, timestamp: new Date().toISOString(), error: 'stat_unavailable' };
        }
        //const USER_HZ = parseInt((await execCommand('getconf CLK_TCK')).trim(),10) || 100;
        //sur certaines plateformes USER_HZ peut être différent de 100
        //exemple macos 1000
        //mais /proc/stat n'existe pas sur macos
        //on pourrait envisager une détection plus tard
        //pour l'instant on se base sur 100
        //https://man7.org/linux
        const USER_HZ = 100;
        const activeCpuTicks = stats.user + stats.nice + stats.system + stats.irq + stats.softirq + stats.steal;
        const idleCpuTicks = stats.idle + stats.iowait
        const activeCpuTime = activeCpuTicks / USER_HZ;
        const idleCpuTime = idleCpuTicks / USER_HZ;

        return {
            ok:true,
            timestamp: new Date().toISOString(),
            unit: 'seconds',
            activeCpuTime,
            idleCpuTime,
            ticks: {
                unit: 'jiffy',
                activeCpuTicks,
                idleCpuTicks,
                USER_HZ
            }
        }
        } catch (error) {
            return { ok: false, timestamp: new Date().toISOString(), error: error.message };
        }
        
    }

    async #parseStat() {
        try {
            const statInfo = (await readFile(this.cpuFiles.stat, 'utf8')).trim().split('\n');
            let cpuStatSnapshot = { timestamp: null, aggregate: {}, perCpu: [] };
            let currentCpuStat = {};
            for (const line of statInfo) {
                if (!line.startsWith('cpu')) continue;
                const parts = line.trim().split(/\s+/);
                const num = (i) => Number(parts[i]) ?? 0;
                const stat = {
                    id: parts[0],
                    user: num(1),
                    nice: num(2),
                    system: num(3),
                    idle: num(4),
                    iowait: num(5),
                    irq: num(6),
                    softirq: num(7),
                    steal: num(8),
                    guest: num(9),
                    guest_nice: num(10)
                }

                if (line.startsWith('cpu ')) {
                    cpuStatSnapshot.aggregate = stat;
                } else {
                    cpuStatSnapshot.perCpu.push(stat);
                }

                currentCpuStat = {};
            }
            cpuStatSnapshot.timestamp = new Date().toISOString();
            this.cpuStatSnapshot = cpuStatSnapshot;
            return cpuStatSnapshot;
        } catch (error) {
            throw new Error(`Failed to parse /proc/stat: ${error.message}`);
        }
    }

    async #parseCpuInfo() {
        //reinitialise before parsing, in case of re-call, e.g. file changed
        // add watch file change later, and cache to update only on change
        this.cpus = [];
        try {
            const normalized = (await readFile(this.cpuFiles.cpuInfo, 'utf8')).replace(/\r\n/g, '\n').split('\n');
            let currentCpu = {};
            let collecting = false;

            for (const line of normalized) {
                if (line.startsWith('processor')) {
                    if (Object.keys(currentCpu).length > 0) {
                        this.cpus.push(currentCpu);
                        currentCpu = {};
                    }
                    collecting = true;
                }

                if (collecting && line.includes(':')) {
                    const [key, value] = line.split(':').map(s => s.trim());
                    const normalizedKey = key.toLowerCase().replaceAll(' ', '_');
                    currentCpu[normalizedKey] = value;
                }

                if (line.startsWith('power management')) {
                    //derniere lingne
                    this.cpus.push(currentCpu);
                    currentCpu = {};
                    collecting = false;
                    // on ne sait pas si "power management" est présent,on ne se base pas dessus
                }
            }

            // pousse le dernier CPU si non vide
            if (Object.keys(currentCpu).length > 0) {
                this.cpus.push(currentCpu);
            }

            return this.cpus;

        } catch (error) {
            throw new Error(`Failed to parse CPU info: ${error.message}`);
        }
    }
}


