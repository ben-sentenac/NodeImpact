import fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { probeRapl } from './sensors/rapl.js';

function worstCaseStatus (statuses = []) {
    const rank = { OK:0,DEGRADED:1,FAILED:2};
    return statuses.reduce((worst,s) => rank[s] > rank[worst] ? s : worst );
}

function getProcStatus() {
    return readFile('/proc/stat','utf8').then((data) => {
        const hasCpuLine = data.split('\n').some(line => line.startsWith('cpu '));
        return hasCpuLine ? 'OK' : 'FAILED';
    }).catch(err => 'FAILED');
}

  /**
    * TODO
    * arrondir côté /healthz (ex. power_W à 3 décimales),
    *  inclure wraps et  un delta par package pour le debug,
*/

export async function buildServer({config, shared} = {}) {

    const app = fastify({ logger: true });

    app.get('/healthz', async (req, reply) => {
        const procStatus = await getProcStatus();
        let raplProbe;
        try {
            raplProbe = await probeRapl(config?.energy?.sensors?.rapl); //ajouter cache plus tard
        } catch (error) {
            raplProbe = {status:'FAILED'};
        }

        const rapl = raplProbe;
        const raplStatus = rapl?.status || 'FAILED';
        const host_energy = shared.energy || null;
        const cpu_distribution = shared.cpu_last || null;
        const app_energy = shared.power_app_last || null

        const status = worstCaseStatus([procStatus,raplStatus]);
        
        return {
            "status": status,
            "linux_proc_status":procStatus,//test minimal /proc/stat
            "details": {
                "rapl_probe": rapl,//état du capteur RAPL (packages, vendor, status)
                "host_energy": host_energy,
                "cpu_distribution":cpu_distribution,
                "app_energy":app_energy
            }
        }
    });
    return app;
}


