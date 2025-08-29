import process from 'node:process';
import path from 'node:path';
import { parseConfig } from '../src/config.js';
import { buildServer } from '../src/server.js';


const CONFIG_FILE = path.join(path.dirname(import.meta.dirname), 'agent.config.json');

let config;

try {
     config = await parseConfig(CONFIG_FILE);
} catch (error) {
   console.error('[FATAL] Invalid config:', error?.message || error);
    process.exit(1); 
}


const PORT = Number(config?.export?.http?.port ?? 9465);
const HOST = config?.export?.http?.listen ?? '0.0.0.0';

const server = await buildServer({config});

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

