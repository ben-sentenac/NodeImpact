import { readFile } from "fs/promises";
import { validateConfigSchema } from "./lib/validateSchema.js";

export async function loadConfig(filename) {
    if (typeof filename !== 'string' || filename.length === 0) {
        throw new Error('Config file path must be a non-empty string');
    }
    try {
        const config = await readFile(filename, 'utf8');
        return JSON.parse(config);
    } catch (err) {
        throw new Error(`Erreur de lecture/parse du fichier de configuration "${filename}": ${err.message}`, { cause: err });
    }
}

export async function parseConfig(configFile) {
    const cfg = await loadConfig(configFile);
    const { valid, errors } = validateConfigSchema(cfg) || {};
    if (valid === false) {
        const msg = (errors || []).map(e => `${e.instancePath || e.schemaPath}: ${e.message}`).join('; ');
        throw new Error(`Configuration invalide: ${msg || 'unknown schema error'}`);
    }
    return cfg;
}