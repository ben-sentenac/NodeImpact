import process from 'node:process';
import path from 'node:path';
import { parseConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';
import RaplReader from '../src/sensors/rapl_reader.js';
import { probeRapl } from '../src/sensors/rapl.js';
import { startMainLoop } from '../src/loop.js';
import HostCpuReader from '../src/sensors/host_cpu_reader.js';
import SystemCpuProfiler from '../src/sensors/cpu.js';
import PidCpuReader from '../src/sensors/pid_cpu_reader.js';


const CONFIG_FILE = path.join(path.dirname(import.meta.dirname), 'agent.config.json');

let config;

try {
     config = await parseConfig(CONFIG_FILE);
} catch (error) {
   console.error('[FATAL] Invalid config:', error?.message || error);
    process.exit(1); 
}


const pid = Number(process.argv.slice(2)[0]) || null;

const PORT = Number(config?.export?.http?.port ?? 9465);
const HOST = config?.export?.http?.listen ?? '0.0.0.0';

let shared = {energy:null};

const probe = await probeRapl(config.energy.sensors.rapl);

if(probe.status === 'OK') {
    const raplReader = new RaplReader(probe);
    const statReader = new HostCpuReader(new SystemCpuProfiler());
    const pidCpuReader = new PidCpuReader({pid});
    const reader = {
        rapl:raplReader,
        stat:statReader,
        pid:pidCpuReader
    };
    startMainLoop({config,reader,shared});
} else {
    console.warn('[agent] RAPL not OK (', probe.status, '). Energy loop disabled for now.', probe.hint);
}

const server = await buildServer({config, shared });

async function start() {
    try {
        await server.listen({host:HOST,port:PORT});
        server.log.info(`listening on http://${HOST}:${PORT}`);
    } catch (error) {
        server.log.error(error);
        process.exit(1);
    }
}

start();

