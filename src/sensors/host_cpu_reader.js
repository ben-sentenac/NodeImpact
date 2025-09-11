import { timeStamp } from "node:console";
import { clampDt } from "../lib/cpu_utils.js";
import SystemCpuProfiler from "./cpu.js";

export default class HostCpuReader {
    constructor({ profiler, hz = 100 }) {
        this.profiler = profiler instanceof SystemCpuProfiler ? profiler : new SystemCpuProfiler;
        this.hz = hz;
        this.state = {
            lastNs: null,//bigint
            lastActiveCpuTicks: null,
            lastIdleCpuTicks: null
        };
    }

    //nowns passé depuis la boucle
    async sample(nowNs) {
        console.log(nowNs)

        const { ticks } = await this.profiler.stat();

        const { activeCpuTicks, idleCpuTicks, USER_HZ } = ticks;

        if (!USER_HZ || USER_HZ <= 0) {
            return { timestamp: new Date().toISOString(), error: 'USER_MH must be > 0 check: getconf CLK_OK on your terminal' };
        }

        //premier appel 
        if (this.state.lastNs === null || this.state.lastActiveCpuTicks === null || this.state.lastIdleCpuTicks === null) {
            this.state.lastNs = nowNs;
            this.state.lastActiveCpuTicks = activeCpuTicks;
            this.state.lastIdleCpuTicks = idleCpuTicks;

            return {
                ok: true,
                timetamp: new Date().toISOString(),
                dt_s: clampDt(0),
                host_active_s: 0,
                host_idle_s: 0,
                ticks: { delta_active: 0, delta_idle: 0 }
            }
        }

        if (!this.lastActiveCpuTicks || !this.lastIdleCpuTicks) {
            this.lastActiveCpuTicks = activeCpuTicks;
            this.lastIdleCpuTicks = idleCpuTicks;
        }

        const delta_active = activeCpuTicks - this.lastActiveCpuTicks;
        const delta_idle = idleCpuTicks - this.lastIdleCpuTicks;

        // clamp contre valeurs négatives
        if (delta_active < 0) delta_active = 0;
        if (delta_idle < 0) delta_idle = 0;

        const delta_ns = nowNs - this.state.lastNs;
        let dt_s = Number(delta_ns) / 1e9;
        dt_s = clampDt(dt_s);
        
        const host_active_s = delta_active / USER_HZ;
        const host_idle_s = delta_idle / USER_HZ;

        //maj state
        this.state.lastNs = nowNs;
        this.lastActiveCpuTicks = activeCpuTicks;
        this.lastIdleCpuTicks = idleCpuTicks;


        return {
            ok: true,
            timeStamp:new Date().toISOString(),               
            dt_s,                     // Δt mur (clampé)
            host_active_s,            // Δ secondes CPU actives (agrégé)
            host_idle_s,              // Δ secondes CPU idle (optionnel, utile pour % busy)
            ticks: {                  // pour debug/metrics
                delta_active,           // Δ ticks actifs (entiers)
                delta_idle              // Δ ticks idle (entiers)
            }
            // (facultatif plus tard) cores: [ { id, active_s }, ... ]
        }
    }
}