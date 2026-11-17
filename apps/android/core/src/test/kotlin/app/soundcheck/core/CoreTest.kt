package app.soundcheck.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.log2
import kotlin.math.sin

class ProtocolTest {
    private val fx = Json.parseToJsonElement(File(System.getProperty("fixtures"), "realtime/clock_sync.json").readText()).jsonObject

    @Test fun clockOffsetGolden() {
        val pong = (SessionEvent.decode(fx["pong"]!!) as SessionEvent.ClockPong).e
        val r = Clock.offset(pong, fx["t3"]!!.jsonPrimitive.double)
        assertEquals(fx["expected"]!!.jsonObject["offsetMs"]!!.jsonPrimitive.double, r.offsetMs, 1e-6)
        assertEquals(fx["expected"]!!.jsonObject["rttMs"]!!.jsonPrimitive.double, r.rttMs, 1e-6)
    }

    @Test fun songPositionGolden() {
        val pong = (SessionEvent.decode(fx["pong"]!!) as SessionEvent.ClockPong).e
        val tr = (SessionEvent.decode(fx["transport"]!!) as SessionEvent.Transport).e
        val off = Clock.offset(pong, fx["t3"]!!.jsonPrimitive.double).offsetMs
        assertEquals(fx["expectedSongPos"]!!.jsonPrimitive.double, Clock.songPosition(tr, fx["phoneNowMs"]!!.jsonPrimitive.double, off), 1e-6)
        assertEquals(12.5, Clock.songPosition(tr.copy(state = TransportState.paused), 9e12, 0.0), 0.0)
    }

    @Test fun webMessagesRoundTrip() {
        val web = Json.parseToJsonElement("""{"type":"pitch","v":1,"memberId":"m","seq":3,"frames":[1.5,220,0.9,-20]}""")
        assertEquals(SessionEvent.Pitch(PitchEvent("m", 3, listOf(1.5, 220.0, 0.9, -20.0))), SessionEvent.decode(web))
        assertNull(SessionEvent.decode(Json.parseToJsonElement("""{"type":"transport","v":2}""")))
        assertNull(SessionEvent.decode(Json.parseToJsonElement("""{"type":"nope","v":1}""")))
        val ev = SessionEvent.Results(ResultsEvent("t", listOf(PerformanceResult("m", null, 84, Grade.B, 1.0, .8, .7, .9, listOf("x")))))
        val json: JsonObject = ev.toJson()
        assertEquals("results", json["type"]!!.jsonPrimitive.content)
        assertEquals(ev, SessionEvent.decode(json))
        assertEquals("session:abc", SCProtocol.channelName("abc"))
    }

    @Test fun bestOffset() {
        assertEquals(12.0, Clock.bestOffset(listOf(Clock.Sample(100.0, 500.0), Clock.Sample(10.0, 20.0), Clock.Sample(12.0, 22.0), Clock.Sample(14.0, 24.0))), 1e-9)
    }
}

class TimingTest {
    private val lines = listOf(LyricLine(2.0, text = "Hello from the stage"), LyricLine(8.0, text = "Every singer"))
    @Test fun lineLookup() {
        assertEquals(-1, Timing.lineAt(lines, 1.0)); assertEquals(0, Timing.lineAt(lines, 2.0)); assertEquals(1, Timing.lineAt(lines, 9.0))
    }
    @Test fun spreadsWords() {
        val notes = listOf(RefNote(2.0, 3.0, 60.0), RefNote(3.0, 6.0, 62.0))
        val w = Timing.wordsOf(lines[0], lines[1], notes)
        assertEquals(listOf("Hello", "from", "the", "stage"), w.map { it.text })
        assertEquals(6.0, w.last().end, 1e-9)
        assertEquals(62.0, Timing.noteAt(notes, 4.0)); assertNull(Timing.noteAt(notes, 7.0))
    }
    @Test fun pitchRules() {
        assertEquals(true, Pitch.liveHit(440.0, 69.0)); assertEquals(true, Pitch.liveHit(220.0, 69.0))
        assertEquals(false, Pitch.liveHit(494.0, 69.0)); assertEquals(true, Pitch.liveHit(466.16, 69.0, 1))
        assertNull(Pitch.liveHit(0.0, 69.0))
        assertEquals("B♭ minor", Pitch.transposeKey("A minor", 1)); assertEquals("B major", Pitch.transposeKey("C major", -1))
        assertEquals(Grade.B, Pitch.grade(84))
    }
}

class PitchDetectorTest {
    private fun sine(hz: Double, sr: Double, sec: Double) = FloatArray((sr * sec).toInt()) { (0.3 * sin(2 * PI * hz * it / sr)).toFloat() }
    @Test fun detectsSines() {
        for (hz in listOf(110.0, 220.0, 440.0, 660.0)) {
            val frames = mutableListOf<PitchFrame>()
            PitchDetector(48_000.0).process(sine(hz, 48_000.0, 0.5)) { frames += it }
            assertTrue(frames.size >= 40)
            frames.takeLast(10).forEach { assertTrue("$hz → ${it.f0}", abs(1200 * log2(it.f0 / hz)) < 15); assertTrue(it.conf > 0.8) }
        }
    }
    @Test fun silenceIsUnvoiced() {
        val frames = mutableListOf<PitchFrame>()
        PitchDetector(44_100.0).process(FloatArray(22_050)) { frames += it }
        assertTrue(frames.all { it.f0 == 0.0 })
        assertEquals(-20.0, PitchDetector.noiseFloor(listOf(-60.0, -50.0, -40.0, -30.0, -20.0)), 0.0)
    }
}

class SmoothedClockTest {
    @Test fun removesJitterAndFollowsSeeks() {
        val c = SmoothedClock()
        val rnd = java.util.Random(7)
        var worst = 0.0
        for (k in 0 until 300) {                       // 6 s at 50 Hz, ±150 ms of jitter around the true position
            val wall = 1_000_000.0 + k * 20
            val truth = 10.0 + k * 0.02
            val s = c.sample(wall, truth + (rnd.nextDouble() - 0.5) * 0.3)
            if (k > 100) worst = maxOf(worst, abs(s - truth))
        }
        assertTrue("worst error $worst", worst < 0.04)
        // a seek is followed immediately
        assertEquals(60.0, c.sample(1_006_100.0, 60.0), 1e-9)
    }
}
