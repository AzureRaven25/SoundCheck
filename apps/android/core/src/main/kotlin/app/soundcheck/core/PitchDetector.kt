package app.soundcheck.core

import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.roundToInt

data class PitchFrame(val f0: Double, val conf: Double, val rmsDb: Double)

/**
 * YIN pitch detector: a straight port of apps/web/public/worklets/pitch-processor.js (and SoundCheckKit), so
 * every platform measures pitch identically. Mono samples at any rate → one frame per 10 ms from a
 * 1024-sample window at ~16 kHz (60–1000 Hz). The difference function uses running energy sums.
 */
class PitchDetector(sampleRate: Double) {
    private val decim = maxOf(1, (sampleRate / 16000).roundToInt())
    private val sr = sampleRate / decim
    private val win = 1024
    private val hop = (sr * 0.01).roundToInt()
    private val minLag = floor(sr / 1000).toInt()
    private val maxLag = minOf(win - 2, ceil(sr / 60).toInt())
    private val buf = FloatArray(win * 2)
    private var len = 0
    private var sinceHop = 0
    private var acc = 0f; private var accN = 0; private var lp = 0f
    private val diff = FloatArray(maxLag + 1)
    private val sq = FloatArray(win + 1)

    fun process(samples: FloatArray, count: Int = samples.size, emit: (PitchFrame) -> Unit) {
        for (k in 0 until count) {
            lp += 0.35f * (samples[k] - lp)
            acc += lp
            if (++accN == decim) { push(acc / decim, emit); acc = 0f; accN = 0 }
        }
    }

    private fun push(x: Float, emit: (PitchFrame) -> Unit) {
        if (len == buf.size) { System.arraycopy(buf, buf.size - win, buf, 0, win); len = win }
        buf[len++] = x
        if (++sinceHop >= hop && len >= win) { sinceHop = 0; emit(analyse(len - win)) }
    }

    private fun analyse(s: Int): PitchFrame {
        val w = win
        var energy = 0f
        for (i in 0 until w) { val v = buf[s + i]; energy += v * v; sq[i + 1] = sq[i] + v * v }
        val rmsDb = 10 * log10(energy.toDouble() / w + 1e-12)
        val half = w - maxLag
        diff[0] = 1f
        var running = 0f
        for (lag in 1..maxLag) {
            var cross = 0f
            for (i in 0 until half) cross += buf[s + i] * buf[s + i + lag]
            val d = maxOf(0f, sq[half] + (sq[lag + half] - sq[lag]) - 2 * cross)
            running += d
            diff[lag] = if (running > 0) d * lag / running else 1f
        }
        var tau = -1
        var lag = minLag
        while (lag < maxLag) {
            if (diff[lag] < 0.15f) {
                while (lag + 1 < maxLag && diff[lag + 1] < diff[lag]) lag++
                tau = lag; break
            }
            lag++
        }
        var f0 = 0.0; var conf = 0.0
        if (tau > 0 && rmsDb > -70) {
            val a = diff[tau - 1].toDouble(); val b = diff[tau].toDouble(); val c = diff[tau + 1].toDouble()
            val den = a + c - 2 * b
            val t = if (den != 0.0) tau + (a - c) / (2 * den) else tau.toDouble()
            f0 = sr / t
            conf = (1 - b).coerceIn(0.0, 1.0)
        }
        return PitchFrame(f0, conf, rmsDb)
    }

    companion object {
        /** Noise floor from calibration levels: 80th percentile. */
        fun noiseFloor(levels: List<Double>): Double = if (levels.isEmpty()) -60.0 else levels.sorted()[(levels.size * 0.8).toInt()]
        /** Same voicing gate as the host and the scoring engine. */
        fun isVoiced(f: PitchFrame, noiseFloorDb: Double?) = f.f0 > 0 && f.conf >= 0.6 && (noiseFloorDb == null || f.rmsDb >= noiseFloorDb + 10)
    }
}
