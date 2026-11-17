package app.soundcheck.core

import io.github.jan.supabase.realtime.RealtimeChannel
import io.github.jan.supabase.realtime.broadcast
import io.github.jan.supabase.realtime.broadcastFlow
import io.github.jan.supabase.realtime.channel
import io.github.jan.supabase.realtime.presenceDataFlow
import io.github.jan.supabase.realtime.realtime
import io.github.jan.supabase.realtime.track
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.round

/**
 * The private Realtime channel `session:<id>` (RLS on realtime.messages admits only the host and members).
 * Messages are protocol events in broadcast event "sc", byte-compatible with web and Apple clients.
 */
class SessionChannel private constructor(private val backend: SoundCheckBackend, val channel: RealtimeChannel) {
    suspend fun send(e: SessionEvent) = channel.broadcast(SCProtocol.BROADCAST_EVENT, e.toJson())
    suspend fun track(p: PresenceState) = channel.track(p)
    suspend fun close() = backend.client.realtime.removeChannel(channel)

    companion object {
        suspend fun open(
            backend: SoundCheckBackend, scope: CoroutineScope, sessionId: String, presenceKey: String,
            onEvent: (SessionEvent) -> Unit, onPresence: ((List<PresenceState>) -> Unit)? = null,
        ): SessionChannel {
            val ch = backend.client.channel(SCProtocol.channelName(sessionId)) {
                isPrivate = true
                broadcast { receiveOwnBroadcasts = false; acknowledgeBroadcasts = false }
                presence { key = presenceKey }
            }
            scope.launch {
                ch.broadcastFlow<JsonObject>(SCProtocol.BROADCAST_EVENT).collect { msg ->
                    // the SDK hands over the payload; tolerate the full envelope too
                    val payload = (msg["payload"] as? JsonObject)?.takeIf { msg.containsKey("event") } ?: msg
                    SessionEvent.decode(payload)?.let(onEvent)
                }
            }
            if (onPresence != null) scope.launch { ch.presenceDataFlow<PresenceState>().collect { onPresence(it.sortedBy { p -> p.displayName }) } }
            ch.subscribe(blockUntilSubscribed = true)
            return SessionChannel(backend, ch)
        }
    }
}

data class PartySinger(val memberId: String, val name: String, val color: String, val mic: MicState, val latencyMs: Double?, val noiseFloorDb: Double?)

/**
 * Host side of SoundCheck Party (the TV): creates the session, publishes the transport clock (re-anchored to
 * the real playback position every 2 s), collects each phone's pitch frames, answers clock pings, and
 * broadcasts live scores and results. Mirror of useHostSession.ts / SoundCheckKit PartyHost.
 */
class PartyHost(private val backend: SoundCheckBackend, private val scope: CoroutineScope, private val platform: Platform = Platform.firetv) {
    private val _session = MutableStateFlow<SessionInfo?>(null); val session: StateFlow<SessionInfo?> = _session
    private val _members = MutableStateFlow<List<PresenceState>>(emptyList())
    private val _status = MutableStateFlow<Map<String, MicStatusEvent>>(emptyMap())
    private val _singers = MutableStateFlow<List<PartySinger>>(emptyList()); val singers: StateFlow<List<PartySinger>> = _singers
    private val _error = MutableStateFlow<String?>(null); val error: StateFlow<String?> = _error
    private var channel: SessionChannel? = null
    private val frames = ConcurrentHashMap<String, MutableList<Double>>()
    private val lastSeq = ConcurrentHashMap<String, Int>()
    @Volatile private var transport: TransportEvent? = null
    private var heartbeat: Job? = null
    var position: () -> Double = { 0.0 }

    private fun recompute() {
        _singers.value = _members.value.filter { it.role == "singer" }.map { m ->
            val st = _status.value[m.memberId]
            PartySinger(m.memberId, m.displayName, m.color, st?.state ?: m.mic, st?.latencyMs, st?.noiseFloorDb)
        }
    }
    val readySingers get() = _singers.value.filter { it.mic == MicState.ready || it.mic == MicState.live }

    suspend fun open(trackId: String?) {
        _error.value = null
        runCatching {
            val s = backend.createSession(platform, trackId)
            val ch = SessionChannel.open(backend, scope, s.id, "host-${backend.userId}", ::handle) { list ->
                _members.value = list.filter { it.role != "host" }; recompute()
            }
            channel = ch
            ch.track(PresenceState("host", backend.displayName, "host", platform, "#FFFFFF", MicState.off))
            _session.value = s
            heartbeat?.cancel()
            heartbeat = scope.launch {
                while (isActive) {
                    delay(2000)
                    val t = transport ?: continue
                    if (t.state != TransportState.playing) continue
                    val now = Clock.nowMs()
                    val predicted = t.songPos + (now - t.hostClock) / 1000
                    val actual = position()
                    // phones extrapolate the last anchor; only move it when the audio clock has really
                    // drifted (> 40 ms), so device jitter never makes their song clock jump
                    val ev = if (kotlin.math.abs(actual - predicted) > 0.04) t.copy(songPos = actual, hostClock = now) else t
                    transport = ev
                    runCatching { ch.send(SessionEvent.Transport(ev)) }
                }
            }
        }.onFailure { _error.value = it.message ?: it.toString() }
    }

    private fun handle(e: SessionEvent) {
        when (e) {
            is SessionEvent.Pitch -> {
                val p = e.e
                if (p.seq <= (lastSeq[p.memberId] ?: -1) || p.frames.size % SCProtocol.FRAME_STRIDE != 0) return
                lastSeq[p.memberId] = p.seq
                frames.getOrPut(p.memberId) { java.util.Collections.synchronizedList(mutableListOf()) }.addAll(p.frames)
            }
            is SessionEvent.ClockPing -> {
                val t1 = Clock.nowMs()
                scope.launch { channel?.send(SessionEvent.ClockPong(ClockPongEvent(e.e.memberId, e.e.id, e.e.t0, t1, Clock.nowMs()))) }
            }
            is SessionEvent.MicStatus -> { _status.value = _status.value + (e.e.memberId to e.e); recompute() }
            else -> Unit
        }
    }

    fun publishTransport(state: TransportState, songPos: Double, keyShift: Int, trackId: String) {
        val ev = TransportEvent(state, trackId, null, songPos, Clock.nowMs(), keyShift, readySingers.map { it.memberId })
        transport = ev
        scope.launch { runCatching { channel?.send(SessionEvent.Transport(ev)) } }
    }

    fun resetTake() { frames.clear(); lastSeq.clear() }
    fun framesOf(memberId: String): List<Double> = frames[memberId]?.let { synchronized(it) { it.toList() } } ?: emptyList()
    fun send(e: SessionEvent) { scope.launch { runCatching { channel?.send(e) } } }

    /** Live hit rate per singer over the take (needs > 20 voiced frames on reference notes). */
    fun liveRates(notes: List<RefNote>, keyShift: Int): Map<String, Double> = _singers.value.mapNotNull { s ->
        val f = framesOf(s.memberId)
        var hit = 0; var total = 0
        var i = 0
        while (i + 3 < f.size) {
            val fr = PitchFrame(f[i + 1], f[i + 2], f[i + 3])
            val ref = Timing.noteAt(notes, f[i])
            if (PitchDetector.isVoiced(fr, s.noiseFloorDb) && ref != null) { total++; if (Pitch.liveHit(fr.f0, ref, keyShift) == true) hit++ }
            i += SCProtocol.FRAME_STRIDE
        }
        if (total > 20) s.memberId to hit.toDouble() / total else null
    }.toMap()

    /** Last ~3 s of a singer's trail: (song time, MIDI or null when unvoiced). */
    fun trail(s: PartySinger): List<Pair<Double, Double?>> {
        val f = framesOf(s.memberId)
        val out = ArrayList<Pair<Double, Double?>>()
        var i = maxOf(0, f.size - SCProtocol.FRAME_STRIDE * 300)
        while (i + 3 < f.size) {
            val fr = PitchFrame(f[i + 1], f[i + 2], f[i + 3])
            out += f[i] to (if (PitchDetector.isVoiced(fr, s.noiseFloorDb)) Pitch.midi(fr.f0) else null)
            i += SCProtocol.FRAME_STRIDE
        }
        return out
    }

    suspend fun close() { heartbeat?.cancel(); runCatching { channel?.close() }; channel = null; _session.value = null }
}

/**
 * Phone side of SoundCheck Party: joins with the code, syncs its clock to the host, and streams 10-frame pitch
 * batches in song time. Mirror of apps/web/src/app/join/[code]/page.tsx and SoundCheckKit PartyGuest.
 */
class PartyGuest(private val backend: SoundCheckBackend, private val scope: CoroutineScope, private val platform: Platform = Platform.android) {
    data class UiState(
        val joined: JoinInfo? = null, val transport: TransportState = TransportState.idle, val hitRate: Double? = null,
        val result: PerformanceResult? = null, val muted: Boolean = false, val line: String = "", val error: String? = null,
    )
    private val _state = MutableStateFlow(UiState()); val state: StateFlow<UiState> = _state
    private var channel: SessionChannel? = null
    @Volatile private var transport: TransportEvent? = null
    private val pongs = mutableListOf<Clock.Sample>()
    @Volatile private var offsetMs = 0.0
    private val batch = ArrayList<Double>()
    private var seq = 0
    @Volatile private var lines: List<LyricLine> = emptyList()
    private var lyricsFor: String? = null
    private var name = "Singer"

    fun songTime(nowMs: Double = Clock.nowMs()) = transport?.let { Clock.songPosition(it, nowMs, offsetMs) } ?: 0.0

    suspend fun join(code: String, displayName: String) {
        name = displayName.trim().ifEmpty { "Singer" }
        _state.value = _state.value.copy(error = null)
        runCatching {
            backend.ensureSignedIn(name)
            val j = backend.joinSession(code.uppercase(), name, platform)
            val ch = SessionChannel.open(backend, scope, j.sessionId, j.memberId, ::handle)
            channel = ch
            ch.track(PresenceState(j.memberId, name, "singer", platform, j.color, MicState.off))
            _state.value = _state.value.copy(joined = j)
            repeat(6) { i ->
                if (i > 0) delay(250)
                ch.send(SessionEvent.ClockPing(ClockPingEvent(j.memberId, i, Clock.nowMs())))
            }
        }.onFailure {
            val m = it.message ?: it.toString()
            _state.value = _state.value.copy(error = if ("invalid" in m) "That code isn’t active. Check the TV." else m)
        }
    }

    private fun handle(e: SessionEvent) {
        val me = _state.value.joined?.memberId
        when (e) {
            is SessionEvent.Transport -> {
                transport = e.e
                _state.value = _state.value.copy(transport = e.e.state)
                val id = e.e.trackId
                if (id != null && id != lyricsFor) { lyricsFor = id; scope.launch { lines = backend.lyrics(id) } }
            }
            is SessionEvent.ClockPong -> if (e.e.memberId == me) {
                synchronized(pongs) { pongs += Clock.offset(e.e, Clock.nowMs()); offsetMs = Clock.bestOffset(pongs) }
            }
            is SessionEvent.LiveScore -> e.e.scores.firstOrNull { it.memberId == me }?.let { _state.value = _state.value.copy(hitRate = it.hitRate) }
            is SessionEvent.Results -> e.e.performances.firstOrNull { it.memberId == me }?.let { _state.value = _state.value.copy(result = it) }
            is SessionEvent.HostCommand -> if (e.e.memberId == me) when (e.e.command) {
                HostCommandEvent.Command.mute -> _state.value = _state.value.copy(muted = true)
                HostCommandEvent.Command.unmute -> _state.value = _state.value.copy(muted = false)
                else -> Unit
            }
            else -> Unit
        }
    }

    suspend fun micReady(noiseFloorDb: Double, latencyMs: Double) {
        val j = _state.value.joined ?: return
        channel?.send(SessionEvent.MicStatus(MicStatusEvent(j.memberId, MicState.ready, noiseFloorDb, latencyMs)))
        channel?.track(PresenceState(j.memberId, name, "singer", platform, j.color, MicState.ready))
    }

    /** One pitch frame from the mic (any thread); batched 10 at a time onto the channel while the song plays. */
    fun push(f: PitchFrame, capturedAtMs: Double) {
        val j = _state.value.joined ?: return
        val t = transport ?: return
        if (t.state != TransportState.playing || _state.value.muted) return
        val st = Clock.songPosition(t, capturedAtMs, offsetMs)
        val out: List<Double>
        synchronized(batch) {
            batch += listOf(round(st * 1000) / 1000, round(f.f0 * 100) / 100, round(f.conf * 1000) / 1000, round(f.rmsDb * 10) / 10)
            if (batch.size < SCProtocol.FRAMES_PER_MESSAGE * SCProtocol.FRAME_STRIDE) return
            out = batch.toList(); batch.clear()
        }
        val ev = PitchEvent(j.memberId, seq++, out)
        scope.launch { runCatching { channel?.send(SessionEvent.Pitch(ev)) } }
    }

    fun refreshLine() {
        val l = lines
        val i = Timing.lineAt(l, songTime())
        _state.value = _state.value.copy(line = if (i >= 0) l[i].text else "")
    }

    suspend fun leave() { runCatching { channel?.close() }; channel = null; _state.value = UiState() }
}
