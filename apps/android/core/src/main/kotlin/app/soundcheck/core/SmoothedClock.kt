package app.soundcheck.core

/**
 * Smooths a jittery playback position (e.g. ExoPlayer's currentPosition on some devices/emulators) by
 * fitting position = a + b·wallTime over the last few seconds of samples (least squares). Seeks, pauses and
 * other jumps larger than [resetJumpS] restart the fit, so it never lags behind a real discontinuity.
 */
class SmoothedClock(private val windowMs: Double = 3000.0, private val resetJumpS: Double = 0.5) {
    private val wall = ArrayDeque<Double>()
    private val pos = ArrayDeque<Double>()

    @Synchronized fun reset() { wall.clear(); pos.clear() }

    /** Record a raw (wallMs, positionS) reading and return the smoothed position at wallMs. */
    @Synchronized fun sample(wallMs: Double, rawPos: Double): Double {
        if (wall.isNotEmpty() && kotlin.math.abs(estimateLocked(wallMs) - rawPos) > resetJumpS) reset()
        wall.addLast(wallMs); pos.addLast(rawPos)
        while (wall.size > 2 && wallMs - wall.first() > windowMs) { wall.removeFirst(); pos.removeFirst() }
        return estimateLocked(wallMs)
    }

    @Synchronized fun estimate(wallMs: Double): Double = estimateLocked(wallMs)

    private fun estimateLocked(wallMs: Double): Double {
        val n = wall.size
        if (n == 0) return 0.0
        if (n < 8 || wall.last() - wall.first() < 400) return pos.last() + (wallMs - wall.last()) / 1000   // too little data: assume 1×
        val w0 = wall.first()
        var sx = 0.0; var sy = 0.0; var sxx = 0.0; var sxy = 0.0
        for (i in 0 until n) { val x = (wall[i] - w0) / 1000; val y = pos[i]; sx += x; sy += y; sxx += x * x; sxy += x * y }
        val den = n * sxx - sx * sx
        if (den == 0.0) return pos.last()
        val b = ((n * sxy - sx * sy) / den).coerceIn(0.9, 1.1)    // playback rate ≈ 1 (tempo never changes)
        val a = (sy - b * sx) / n
        return a + b * (wallMs - w0) / 1000
    }
}
