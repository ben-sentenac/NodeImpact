export function clampDt(dt, min = 0.2, max = 5) {
    if (!Number.isFinite(dt) || dt <= 0) {
        return min;
    }
    if (dt < min) return min;
    if (dt > max) return max;
    return dt;
}