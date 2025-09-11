import process from 'node:process';
import { clampDt } from './lib/cpu_utils.js';
import os from 'node:os';

export function startMainLoop({ config, reader = { rapl: null, stat: null, pid: null }, shared, logger = console }) {
    const period_ms = config?.agent?.sampling?.period_ms ?? 1000;
    let inFilght = false;//Si un tick met plus longtemps que period_ms, le suivant peut chevaucher

    const tick = async () => {
        if (inFilght) return;//evite le chevauchemant
        inFilght = true;
        const nowNs = process.hrtime.bigint();
        try {
            const [raplReader, statReader, pidReader] = await Promise.all(
                [
                    reader.rapl.sample(nowNs),
                    reader.stat.sample(nowNs),
                    reader.pid.sample()
                ]);


            const share_raw = pidReader.app_cpu_s / Math.max(statReader.host_active_s, 1e-9);
            const share = clampDt(share_raw, 0, os.cpus().length);

            // puissance attribuée
            const P_app = share * raplReader.power_W;
            const E_app_delta_J = P_app * raplReader.delta_ts;


            shared.cpu_distribution = {
                target_pid: pidReader.pid,
                host_cpu_seconds_interval: statReader.host_active_s,
                app_cpu_seconds_interval: pidReader.app_cpu_s,
                app_share_ratio:share,
                pid_restarted: pidReader.pid_restarted
            };

            shared.app_energy = {
                average_power_watts: P_app,
                energy_joules_interval:E_app_delta_J
            };

            shared.host_energy = {
                average_power_watts: Number(raplReader.power_w.toFixed(3)),
                energy_joules_interval: Number(raplReader.delta_j.toFixed(3)),
                interval_duration_seconds: raplReader.delta_ts,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            logger.warn('[loop] rapl or  sample error:', error);
        } finally {
            inFilght = false;
        }
    }

    const timer = setInterval(tick, period_ms);
    if (typeof timer.unref === 'function') timer.unref?.(); // ne bloque pas l’extinction du process

    tick();

    return () => clearInterval(timer);
}