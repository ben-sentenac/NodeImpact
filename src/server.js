import fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { probeRapl } from './sensors/rapl.js';

function worstCaseStatus (statuses = []) {
    const rank = { OK:0,DEGRADED:1,FAILED:2};
    return statuses.reduce((worst,s) => rank[s] > rank[worst] ? s : worst );
}

function getProcStatus() {
    return readFile('/proc/stat','utf8').then((data) => {
        const hasCpuLine = data.split('\n').some(line => line.startsWith('cpu'));
        return hasCpuLine ? 'OK' : 'FAILED';
    }).catch(err => 'FAILED');
}

export async function buildServer({config} = {}) {
    const app = fastify({ logger: true });

    app.get('/healthz', async (req, reply) => {
        const procStatus = await getProcStatus();
        let raplProbe;
        try {
            raplProbe = await probeRapl(config?.energy?.sensor?.rapl);
        } catch (error) {
            raplProbe = {status:'FAILED'};
        }

        const rapl = raplProbe;

        const raplStatus = rapl?.status || 'FAILED';

        const status = worstCaseStatus([procStatus,raplStatus]);
        
        return {
            "status": status,
            "details": {
                "proc": procStatus,
                "rapl": rapl
            }
        }
    });
    return app;
}


