import process from 'node:process';


export function startMainLoop({ config, raplReader, shared, logger = console }) {
    const period_ms = config?.agent?.sampling?.period_ms ?? 1000;
    let inFilght = false;//Si un tick met plus longtemps que period_ms, le suivant peut chevaucher

    const tick = async () => {
        if(!inFilght) return;//evite le chevauchemant
        inFilght = true;
        const nowNs = process.hrtime.bigint();

        try {
           const reader = await raplReader.sample(nowNs);

            shared.energy = {
                power_W: reader.power_w,
                delta_J: reader.delta_j,
                dt_s: reader.delta_ts,
                ts: new Date().toISOString()
            }
        } catch (error) {
            logger.warn('[loop] rapl sample error:', error?.message || error);
        } finally {
            inFilght = false;
        }
    }

    const timer = setInterval(tick, period_ms);
    if (typeof timer.unref === 'function') timer.unref?.(); // ne bloque pas l’extinction du process

    tick();

    return () => clearInterval(timer);
}