package app.soundcheck.core

import kotlin.math.abs
import kotlin.math.log2
import kotlin.math.min
import kotlin.math.roundToInt

/** Lyric and melody timing (mirror of apps/web/src/stage/StageLyrics.tsx and packages/scoring). */
object Timing {
    /** Index of the line active at t (last line whose start ≤ t), -1 before the first. */
    fun lineAt(lines: List<LyricLine>, t: Double): Int {
        var lo = 0; var hi = lines.size - 1; var ans = -1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            if ((lines[mid].start ?: Double.POSITIVE_INFINITY) <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
        }
        return ans
    }

    /** Words for a line: real word timing when available, else spread over the line's sung notes. */
    fun wordsOf(line: LyricLine, next: LyricLine?, notes: List<RefNote>): List<LyricWord> {
        line.words?.takeIf { it.isNotEmpty() }?.let { return it }
        val start = line.start ?: 0.0
        val end = next?.start ?: line.end ?: (start + 4)
        val sungEnd = maxOf(start + 0.5, notes.filter { it.start >= start - 0.1 && it.start < end }.maxOfOrNull { it.end } ?: 0.0)
        val words = line.text.split(Regex("\\s+")).filter { it.isNotEmpty() }
        val total = words.sumOf { maxOf(1, it.length) }.toDouble()
        var acc = start
        return words.map { w ->
            val d = (sungEnd - start) * maxOf(1, w.length) / total
            LyricWord(acc, acc + d, w).also { acc += d }
        }
    }

    fun progress(w: LyricWord, t: Double): Double = when {
        t <= w.start -> 0.0
        t >= w.end -> 1.0
        else -> (t - w.start) / maxOf(0.001, w.end - w.start)
    }

    /** Reference MIDI pitch of the note sounding at t, null between notes. */
    fun noteAt(notes: List<RefNote>, t: Double): Double? {
        var lo = 0; var hi = notes.size - 1
        while (lo <= hi) {
            val m = (lo + hi) ushr 1
            when {
                notes[m].end <= t -> lo = m + 1
                notes[m].start > t -> hi = m - 1
                else -> return notes[m].pitch
            }
        }
        return null
    }
}

object Pitch {
    fun hzToCents(hz: Double) = 1200 * log2(hz / 440) + 6900
    fun midi(hz: Double) = 69 + 12 * log2(hz / 440)
    private fun folded(cents: Double, target: Double): Double {
        val d = (((cents - target) % 1200) + 1200) % 1200
        return min(d, 1200 - d)
    }
    /** Live HUD hit test (same rule as @soundcheck/scoring liveHit): within a semitone, any octave. */
    fun liveHit(f0: Double, refMidi: Double?, keyShift: Int = 0): Boolean? {
        if (refMidi == null || f0 <= 0) return null
        return folded(hzToCents(f0), (refMidi + keyShift) * 100) <= 100
    }
    fun grade(score: Int) = when { score >= 95 -> Grade.S; score >= 85 -> Grade.A; score >= 70 -> Grade.B; score >= 55 -> Grade.C; else -> Grade.D }

    private val names = listOf("C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B")
    private val plain = listOf("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
    fun transposeKey(key: String?, n: Int): String? {
        if (key == null) return null
        val parts = key.split(" ", limit = 2)
        val i = plain.indexOf(parts[0]).takeIf { it >= 0 } ?: return key
        return "${names[((i + n) % 12 + 12) % 12]} ${parts.getOrElse(1) { "" }}".trim()
    }
    /** Fold a sung MIDI value to the octave nearest the reference (for drawing trails). */
    fun foldTo(midi: Double, target: Double) = midi + 12 * ((target - midi) / 12).roundToInt()
    @Suppress("unused") private fun unused() = abs(0)
}
