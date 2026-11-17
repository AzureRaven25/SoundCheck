package app.soundcheck.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive

/**
 * SoundCheck Stage realtime protocol v1: a mirror of packages/contracts/src/realtime.ts (and SoundCheckKit).
 * Broadcast event "sc" on the private channel `session:<id>`. songPos/t are song seconds; clocks are epoch ms.
 */
object SCProtocol {
    const val VERSION = 1
    const val FRAME_STRIDE = 4
    const val FRAMES_PER_MESSAGE = 10
    const val BROADCAST_EVENT = "sc"
    fun channelName(sessionId: String) = "session:$sessionId"

    val json = Json { ignoreUnknownKeys = true; encodeDefaults = true; explicitNulls = true }
}

@Serializable enum class Platform { web, tvos, firetv, ios, android }
@Serializable enum class MicState { off, calibrating, ready, live, muted, error }
@Serializable enum class TransportState { idle, countdown, playing, paused, ended }
@Serializable enum class Grade { S, A, B, C, D }

@Serializable
data class TransportEvent(
    val state: TransportState, val trackId: String?, val queueItemId: String? = null, val songPos: Double,
    val hostClock: Double, val keyShift: Int, val singerMemberIds: List<String>,
    val type: String = "transport", val v: Int = SCProtocol.VERSION,
)

@Serializable
data class PitchEvent(
    val memberId: String, val seq: Int, val frames: List<Double>,
    val type: String = "pitch", val v: Int = SCProtocol.VERSION,
)

@Serializable
data class ClockPingEvent(val memberId: String, val id: Int, val t0: Double, val type: String = "clock_ping", val v: Int = SCProtocol.VERSION)

@Serializable
data class ClockPongEvent(
    val memberId: String, val id: Int, val t0: Double, val t1: Double, val t2: Double,
    val type: String = "clock_pong", val v: Int = SCProtocol.VERSION,
)

@Serializable
data class MicStatusEvent(
    val memberId: String, val state: MicState, val noiseFloorDb: Double?, val latencyMs: Double?, val error: String? = null,
    val type: String = "mic_status", val v: Int = SCProtocol.VERSION,
)

@Serializable
data class LiveScoreEvent(val scores: List<Entry>, val type: String = "live_score", val v: Int = SCProtocol.VERSION) {
    @Serializable data class Entry(val memberId: String, val hitRate: Double, val combo: Int)
}

@Serializable
data class PerformanceResult(
    val memberId: String, val performanceId: String?, val score: Int, val grade: Grade,
    val pitch: Double, val timing: Double, val rhythm: Double, val stability: Double, val feedback: List<String>,
    /** SoundCheck Score v1.1+ (absent from older results) */
    val duration: Double? = null, val transitions: Double? = null,
)

@Serializable data class GroupScore(val score: Int, val grade: Grade, val singers: Int)

@Serializable
data class ResultsEvent(val trackId: String, val performances: List<PerformanceResult>, val group: GroupScore? = null, val type: String = "results", val v: Int = SCProtocol.VERSION)

@Serializable
data class HostCommandEvent(
    val memberId: String, val command: Command, val value: Double? = null,
    val type: String = "host_command", val v: Int = SCProtocol.VERSION,
) {
    @Serializable enum class Command { mute, unmute, kick, @SerialName("set_volume") setVolume }
}

/** Any protocol message. */
sealed interface SessionEvent {
    data class Transport(val e: TransportEvent) : SessionEvent
    data class Pitch(val e: PitchEvent) : SessionEvent
    data class ClockPing(val e: ClockPingEvent) : SessionEvent
    data class ClockPong(val e: ClockPongEvent) : SessionEvent
    data class MicStatus(val e: MicStatusEvent) : SessionEvent
    data class LiveScore(val e: LiveScoreEvent) : SessionEvent
    data class Results(val e: ResultsEvent) : SessionEvent
    data class HostCommand(val e: HostCommandEvent) : SessionEvent
    /** The session's song queue changed; re-read it (session_queue_list). Carries no data. */
    data object QueueChanged : SessionEvent

    fun toJson(): JsonObject = with(SCProtocol.json) {
        when (this@SessionEvent) {
            is Transport -> encodeToJsonElement(e); is Pitch -> encodeToJsonElement(e)
            is ClockPing -> encodeToJsonElement(e); is ClockPong -> encodeToJsonElement(e)
            is MicStatus -> encodeToJsonElement(e); is LiveScore -> encodeToJsonElement(e)
            is Results -> encodeToJsonElement(e); is HostCommand -> encodeToJsonElement(e)
            QueueChanged -> kotlinx.serialization.json.buildJsonObject {
                put("type", kotlinx.serialization.json.JsonPrimitive("queue_changed")); put("v", kotlinx.serialization.json.JsonPrimitive(SCProtocol.VERSION))
            }
        } as JsonObject
    }

    companion object {
        /** Decode a broadcast payload; unknown types or other protocol versions → null. */
        fun decode(el: JsonElement): SessionEvent? = runCatching {
            val o = el as? JsonObject ?: return null
            if (o["v"]?.jsonPrimitive?.int != SCProtocol.VERSION) return null
            val j = SCProtocol.json
            when (o["type"]?.jsonPrimitive?.content) {
                "transport" -> Transport(j.decodeFromJsonElement(o))
                "pitch" -> Pitch(j.decodeFromJsonElement(o))
                "clock_ping" -> ClockPing(j.decodeFromJsonElement(o))
                "clock_pong" -> ClockPong(j.decodeFromJsonElement(o))
                "mic_status" -> MicStatus(j.decodeFromJsonElement(o))
                "live_score" -> LiveScore(j.decodeFromJsonElement(o))
                "results" -> Results(j.decodeFromJsonElement(o))
                "host_command" -> HostCommand(j.decodeFromJsonElement(o))
                "queue_changed" -> QueueChanged
                else -> null
            }
        }.getOrNull()
    }
}

@Serializable
data class PresenceState(
    val memberId: String, val displayName: String, val role: String, val platform: Platform, val color: String, val mic: MicState,
)

object Clock {
    data class Sample(val offsetMs: Double, val rttMs: Double)

    /** Clock offset (host − phone, ms) and round-trip time from a ping/pong exchange (NTP-style). */
    fun offset(p: ClockPongEvent, t3: Double) = Sample(((p.t1 - p.t0) + (p.t2 - t3)) / 2, t3 - p.t0 - (p.t2 - p.t1))

    /** Song position a phone should be at now, from the latest transport event and clock offset. */
    fun songPosition(ev: TransportEvent, phoneNowMs: Double, offsetMs: Double): Double {
        if (ev.state != TransportState.playing) return ev.songPos
        return ev.songPos + maxOf(0.0, phoneNowMs + offsetMs - ev.hostClock) / 1000
    }

    /** Mean offset of the 3 lowest-RTT samples. */
    fun bestOffset(samples: List<Sample>): Double {
        val best = samples.sortedBy { it.rttMs }.take(3)
        return if (best.isEmpty()) 0.0 else best.sumOf { it.offsetMs } / best.size
    }

    fun nowMs(): Double = System.currentTimeMillis().toDouble()
}
