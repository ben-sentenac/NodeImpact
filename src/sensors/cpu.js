import path from 'node:path';
import { readFile } from 'node:fs/promises';


const FLAG_CATEGORIES = {
  [Symbol('virtualization')]: ['vmx', 'svm', 'ept', 'npt', 'tpr_shadow', 'vme'],
  [Symbol('security')]: ['nx', 'smap', 'smep', 'md_clear', 'pti', 'lahf_lm', 'rdtscp'],
  [Symbol('crypto')]: ['aes', 'rdrand', 'rdseed', 'sha_ni'],
  [Symbol('performance')]: [
    'sse', 'sse2', 'sse3', 'ssse3', 'sse4_1', 'sse4_2',
    'avx', 'avx2', 'fma', 'mmx', 'pni', 'popcnt',
    'xsave', 'xsaveopt', 'xsavec', 'xsaves'
  ],
  [Symbol('management')]: ['hwp', 'tsc', 'cpuid', 'clflush', 'invariant_tsc', 'constant_tsc']
};


export default class SystemCpuProfiler {
  
    constructor(filePath = '/proc/cpuinfo') {
        this.filePath = filePath;
        this.cpus = [];
    }

    analyzeFlags(flags) {
        const _flags = flags.split(' ');
        return {
            virtualisable: _flags.includes('vmx') || _flags.includes('svm'),
            aesSupport: _flags.includes('aes'),
            hyperThreading: _flags.includes('ht'),
            secureBootCapable: _flags.includes('nx') && _flags.includes('smap') && _flags.includes('smep')
        };
    }

    #groupFlags(flagsStr) {
    const flags = flagsStr.split(' ');
    const grouped = {};

    for (const symbol of Object.getOwnPropertySymbols(FLAG_CATEGORIES)) {
      const categoryName = symbol.description;
      grouped[categoryName] = flags.filter(f => FLAG_CATEGORIES[symbol].includes(f));
    }

    return grouped;
  }

    async getAllCpusDetails() {
        return this.cpus.length > 0 ? this.cpus : await this.#ParseCpuInfo();
    }

    async cpuInfo() {
        const cpus = await this.#ParseCpuInfo();
        const flags = { ...this.analyzeFlags(cpus[0]['flags']) };
        const timeStamps = new Date(Date.now()).toISOString();
        const freqMHz = cpus.map(cpu => parseFloat(cpu['cpu_mhz']));
        const totalFreq = freqMHz.reduce((sum, freq) => sum + freq, 0);
        const maxFreq = Math.max(...freqMHz);
        const minFreq = Math.min(...freqMHz);
        const spreadFreq = maxFreq - minFreq;
        const averageFreq = totalFreq / freqMHz.length;
        const logicalCores = cpus[0]['siblings'];
        const cpuLoadEstimate = averageFreq / maxFreq;

        return {
            timeStamps,
            cpu: {
                 vendor: cpus[0]['vendor_id'], 
                 model: cpus[0]['model_name'],
                 cores:{
                    physical: parseInt(cpus[0]['cpu_cores']),
                    logical:parseInt(logicalCores)
                 },
                 frequency:{
                    unit:'MHz',
                    total:totalFreq,
                    average:averageFreq,
                    max:maxFreq,
                    min:minFreq,
                    spread:spreadFreq,
                    loadEstimate:cpuLoadEstimate
                 },
                 cache:cpus[0]['cache_size'],
                 powerManagement: cpus[0]['power_management'],
                 capabilities: flags,
            },
        }
    }

    async #ParseCpuInfo() {
        try {
            const normalized = (await readFile(this.filePath, 'utf8')).replace(/\r\n/g, '\n').split('\n');
            let currentCpu = {};
            let model = undefined;
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
                }
            }

            return this.cpus;

        } catch (error) {
            throw new Error(`Failed to parse CPU info: ${error.message}`);
        }
    }
}

