import Ajv from "ajv";
import configSchema from '../config.schema.json' with { type: 'json' };

const ajv = new Ajv();


export function validateConfigSchema(_config) {
    const validate = ajv.compile(configSchema);
    const valid = validate(_config);

    if(!valid) {
       const errors = validate.errors.map(err => `${err.instancePath} ${err.message}`).join('\n');
        throw new Error(`Config_validation_failed :\n${errors}`)
    }

    return true;
}