package app.soundcheck.tv

import android.graphics.Bitmap
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Button
import androidx.tv.material3.OutlinedButton
import androidx.tv.material3.Text
import app.soundcheck.core.LiveScoreEvent
import app.soundcheck.core.PartyHost
import app.soundcheck.core.PartySinger
import app.soundcheck.core.PerformanceResult
import app.soundcheck.core.Pitch
import app.soundcheck.core.Platform
import app.soundcheck.core.RefNote
import app.soundcheck.core.ResultsEvent
import app.soundcheck.core.ScoreSinger
import app.soundcheck.core.SessionEvent
import app.soundcheck.core.StageData
import app.soundcheck.core.StageLoad
import app.soundcheck.core.Timing
import app.soundcheck.core.TransportState
import app.soundcheck.core.LyricLine
import app.soundcheck.core.MicState
import app.soundcheck.core.VocalRange
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.delay
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

private enum class Phase { Loading, Lobby, Warming, Singing, Scoring, Results }

/**
 * SoundCheck Stage / Party on Fire TV. The TV has no mic, so singers use their phones:
 * lobby (QR + code) → band warms up → sing (lyric wipe, melody guide, per-singer trails) → scores.
 */
@Composable
fun StageScreen(initialTrack: String, autostart: Boolean, onExit: () -> Unit) {
    var trackId by remember { mutableStateOf(initialTrack) }
    var songNumber by remember { mutableIntStateOf(0) }    // bumps per song, so the same song can be queued again
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val backend = Services.backend
    var engine by remember { mutableStateOf(StageEngine(ctx)) }
    val host = remember { PartyHost(backend, scope, Platform.firetv).also { h -> h.position = { engine.position() } } }
    val queue by host.queue.collectAsState()
    var phase by remember { mutableStateOf(Phase.Loading) }
    var data by remember { mutableStateOf<StageData?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var keyShift by remember { mutableIntStateOf(0) }
    var guide by remember { mutableFloatStateOf(0f) }
    var rates by remember { mutableStateOf(emptyMap<String, Double>()) }
    var results by remember { mutableStateOf(emptyList<Pair<PartySinger, PerformanceResult>>()) }
    var group by remember { mutableStateOf<app.soundcheck.core.GroupScore?>(null) }
    val session by host.session.collectAsState()
    val singers by host.singers.collectAsState()
    val hostError by host.error.collectAsState()

    DisposableEffect(Unit) { onDispose { engine.release(); scope.launch { host.close() } } }
    BackHandler(onBack = onExit)

    suspend fun finish() {
        if (phase != Phase.Singing) return
        val d = data ?: return
        engine.pause()
        host.publishTransport(TransportState.ended, engine.position(), keyShift, trackId)
        val sid = session?.id ?: return
        val voiced = singers.filter { host.framesOf(it.memberId).size >= 400 }
        if (voiced.isEmpty()) { message = "We didn’t hear any phones. Check that each singer turned their mic on."; results = emptyList(); phase = Phase.Results; return }
        phase = Phase.Scoring
        if (BuildConfig.DEBUG) voiced.forEach { s ->
            val f = host.framesOf(s.memberId)
            val voicedN = (f.indices step 4).count { f[it + 1] > 0 && f[it + 2] >= 0.6 }
            println("[soundcheck] scoring ${s.name}: ${f.size / 4} frames, t ${f.firstOrNull()}..${f.getOrNull(f.size - 4)}, voiced $voicedN, floor ${s.noiseFloorDb}, enginePos ${engine.position()}")
        }
        runCatching {
            backend.score(d.track.id, sid, keyShift, voiced.map { ScoreSinger(it.memberId, host.framesOf(it.memberId), null, it.noiseFloorDb) })
        }.onSuccess { scored ->
            val byId = voiced.associateBy { it.memberId }
            results = scored.mapNotNull { r -> byId[r.memberId]?.let { it to r.asResult() } }
            group = if (scored.size > 1) scored.map { it.score }.average().roundToInt().let { app.soundcheck.core.GroupScore(it, Pitch.grade(it), scored.size) } else null
            host.send(SessionEvent.Results(ResultsEvent(trackId, scored.map { it.asResult() }, group)))
            message = null
        }.onFailure { println("[soundcheck] scoring failed: ${it.message}"); message = "Scoring failed. Please try again." }
        phase = Phase.Results
    }

    suspend fun start() {
        val d = data ?: return
        phase = Phase.Warming
        runCatching {
            if (!engine.loaded) { engine.load(d.instrumentalUrl, d.vocalsUrl); engine.onEnded = { scope.launch { finish() } } }
            engine.setKey(keyShift); engine.setGuide(guide)
            host.resetTake()
            engine.play(0.0)
            host.publishTransport(TransportState.playing, 0.0, keyShift, d.track.id)
            phase = Phase.Singing
        }.onFailure { message = "Couldn’t load the karaoke tracks."; phase = Phase.Lobby }
    }

    LaunchedEffect(trackId, songNumber) {
        phase = Phase.Loading; data = null; message = null; results = emptyList(); group = null; keyShift = 0
        runCatching { backend.stageData(trackId) }.onSuccess { r ->
            when (r) {
                is StageLoad.Ready -> {
                    data = r.data
                    if (session == null) host.open(trackId) else host.switchTrack(trackId)   // same party, phones stay joined
                    phase = Phase.Lobby
                }
                is StageLoad.NotReady -> message = "“${r.title}” isn’t karaoke-ready yet. Upload your copy on the SoundCheck website."
                StageLoad.SignedOut -> message = "Sign in on the Account tab to sing."
            }
        }.onFailure { message = "Couldn’t open Stage: ${it.message}" }
    }

    // next requested song: same session, fresh players
    suspend fun singNext(skip: Boolean = false) {
        val next = host.advance(skip) ?: return
        engine.release(); engine = StageEngine(ctx)
        trackId = next
        songNumber++
    }
    // debug-only: also take the next request automatically after the results
    LaunchedEffect(phase, queue) {
        if (autostart && phase == Phase.Results && queue.any { it.status == "queued" }) { delay(3000); singNext() }
    }
    // debug-only autostart (see MainActivity) once a phone's mic is ready
    LaunchedEffect(singers, phase) {
        if (autostart && phase == Phase.Lobby && singers.any { it.mic == MicState.ready }) start()
    }
    // live scores ~2 Hz: TV chips + each phone's HUD
    LaunchedEffect(phase) {
        while (phase == Phase.Singing) {
            delay(500)
            val d = data ?: break
            rates = host.liveRates(d.notes, keyShift)
            host.send(SessionEvent.LiveScore(LiveScoreEvent(rates.map { LiveScoreEvent.Entry(it.key, it.value, 0) })))
        }
    }

    Box(Modifier.fillMaxSize().background(SC.ink950), contentAlignment = Alignment.Center) {
        val d = data
        when {
            phase == Phase.Loading || d == null -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
                Text(message ?: "Setting the stage…", color = SC.ink300, fontSize = 22.sp, textAlign = TextAlign.Center)
                // a requested song that isn't karaoke-ready: move past it without losing the party
                if (message != null && session != null && queue.any { it.status == "queued" }) Button(onClick = { scope.launch { singNext(skip = true) } }) { Text("Skip to the next request") }
            }
            phase == Phase.Lobby -> Lobby(d, session?.code, singers, hostError ?: message, queue.filter { it.status == "queued" }, onStart = { scope.launch { start() } })
            phase == Phase.Warming -> Text("Warming up the band…", color = SC.ink300, fontSize = 22.sp)
            phase == Phase.Singing -> Singing(d, engine, host, singers, rates, keyShift, guide,
                onToggle = {
                    if (engine.isPlaying) { engine.pause(); host.publishTransport(TransportState.paused, engine.position(), keyShift, trackId) }
                    else { engine.play(); host.publishTransport(TransportState.playing, engine.position(), keyShift, trackId) }
                },
                onFinish = { scope.launch { finish() } },
                onKey = { k ->
                    keyShift = k.coerceIn(-6, 6); engine.setKey(keyShift)
                    if (engine.isPlaying) host.publishTransport(TransportState.playing, engine.position(), keyShift, trackId)
                },
                onGuide = { guide = if (guide > 0f) 0f else 0.6f; engine.setGuide(guide) })
            phase == Phase.Scoring -> Text("Scoring everyone…", color = SC.ink300, fontSize = 22.sp)
            else -> ResultsView(results, message, group, queue.firstOrNull { it.status == "queued" },
                onAgain = { results = emptyList(); message = null; phase = Phase.Lobby }, onNext = { scope.launch { singNext() } }, onDone = onExit)
        }
    }
}

@Composable
private fun Lobby(d: StageData, code: String?, singers: List<PartySinger>, error: String?, upNext: List<app.soundcheck.core.QueueItem>, onStart: () -> Unit) {
    val focus = remember { FocusRequester() }
    val anyReady = singers.any { it.mic == MicState.ready || it.mic == MicState.live }
    // the Start button is disabled (unfocusable) until a phone's mic is ready: hand focus to it then
    LaunchedEffect(anyReady) { if (anyReady) runCatching { focus.requestFocus() } }
    Row(horizontalArrangement = Arrangement.spacedBy(64.dp), verticalAlignment = Alignment.CenterVertically) {
        if (code != null) {
            val qr = remember(code) { qrBitmap(Services.backend.joinUrl(code)) }
            Image(qr.asImageBitmap(), contentDescription = "QR code to join", modifier = Modifier.size(320.dp).clip(RoundedCornerShape(20.dp)).background(Color.White).padding(16.dp))
        }
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Title(d.track.title, 44)
            Text(d.track.artistCredit, color = SC.ink300, fontSize = 22.sp)
            if (code != null) {
                val site = Services.backend.config.siteUrl.removePrefix("https://").removePrefix("http://").trimEnd('/')
                Text("Scan with your phone, or open $site/join and enter", color = SC.ink300, fontSize = 18.sp)
                Text(code.toCharArray().joinToString(" "), fontSize = 84.sp, fontWeight = FontWeight.Black, color = SC.ink50,
                    modifier = Modifier.semantics { contentDescription = "Pairing code $code" })
            }
            if (singers.isEmpty()) Text("Waiting for singers…", color = SC.ink500, fontSize = 18.sp)
            singers.forEach { s ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(Modifier.size(14.dp).clip(CircleShape).background(SC.hex(s.color)))
                    Text(s.name, fontWeight = FontWeight.Bold, fontSize = 20.sp, color = SC.ink50)
                    Text(if (s.mic == MicState.ready) "mic ready" else "mic off", color = if (s.mic == MicState.ready) SC.success else SC.ink500, fontSize = 16.sp)
                }
            }
            error?.let { Text(it, color = SC.danger) }
            if (upNext.isEmpty()) Text("Singers can request songs from their phones.", color = SC.ink500, fontSize = 15.sp)
            else Column(Modifier.semantics { contentDescription = "Up next" }) {
                Text("UP NEXT", color = SC.ink300, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                upNext.take(4).forEachIndexed { i, q ->
                    Text("${i + 1}. ${q.title} · ${q.artistCredit}" + (q.requesterName?.let { " — $it" } ?: ""), color = SC.ink50, fontSize = 16.sp, maxLines = 1)
                }
            }
            Button(onClick = onStart, enabled = anyReady, modifier = Modifier.focusRequester(focus)) { Text("Start singing", fontSize = 20.sp) }
        }
    }
}

@Composable
private fun Singing(
    d: StageData, engine: StageEngine, host: PartyHost, singers: List<PartySinger>, rates: Map<String, Double>, keyShift: Int, guide: Float,
    onToggle: () -> Unit, onFinish: () -> Unit, onKey: (Int) -> Unit, onGuide: () -> Unit,
) {
    var t by remember { mutableDoubleStateOf(0.0) }
    LaunchedEffect(Unit) { while (true) withFrameNanos { t = engine.position() } }
    Column(Modifier.fillMaxSize().padding(horizontal = 56.dp, vertical = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(d.track.title, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = SC.ink50)
            Spacer(Modifier.weight(1f))
            Pitch.transposeKey(d.musicalKey, keyShift)?.let { Chip("KEY ${it.uppercase()}", SC.ink50) }
            singers.forEach { s -> Chip(s.name.uppercase() + (rates[s.memberId]?.let { " ${(it * 100).toInt()}%" } ?: ""), SC.hex(s.color)) }
        }
        Spacer(Modifier.height(20.dp))
        PitchHud(d.notes, keyShift, t, singers.map { Triple(SC.hex(it.color), it, host.trail(it)) }, d.vocalRange,
            Modifier.fillMaxWidth().height(180.dp).clip(RoundedCornerShape(20.dp)).background(SC.ink900))
        Spacer(Modifier.weight(1f))
        Lyrics(d.lines, d.notes, t)
        Spacer(Modifier.weight(1f))
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
            Button(onClick = onToggle) { Text(if (engine.isPlaying) "Pause" else "Play") }
            OutlinedButton(onClick = onFinish) { Text("Finish") }
            OutlinedButton(onClick = { onKey(keyShift - 1) }) { Text("Key −") }
            Text(if (keyShift > 0) "+$keyShift" else "$keyShift", fontSize = 22.sp, fontWeight = FontWeight.Bold, color = SC.ink50)
            OutlinedButton(onClick = { onKey(keyShift + 1) }) { Text("Key +") }
            OutlinedButton(onClick = onGuide) { Text(if (guide > 0f) "Guide vocal on" else "Guide vocal off") }
        }
    }
}

@Composable
private fun Chip(s: String, c: Color) {
    Text(s, Modifier.padding(start = 10.dp).clip(RoundedCornerShape(8.dp)).background(SC.ink800).padding(horizontal = 12.dp, vertical = 6.dp),
        color = c, fontSize = 14.sp, fontWeight = FontWeight.Bold)
}

/** Current line with a per-word colour wipe, next line dimmed below. */
@Composable
private fun Lyrics(lines: List<LyricLine>, notes: List<RefNote>, t: Double) {
    val i = Timing.lineAt(lines, t)
    val cur = maxOf(0, i)
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp), modifier = Modifier.widthIn(max = 1400.dp)) {
        if (lines.isEmpty()) { Text("♪", fontSize = 64.sp, color = SC.ink300); return@Column }
        val words = Timing.wordsOf(lines[cur], lines.getOrNull(cur + 1), notes)
        val text = buildAnnotatedString {
            words.forEachIndexed { k, w ->
                val p = if (i < 0) 0.0 else Timing.progress(w, t)
                withStyle(SpanStyle(color = when { p >= 1 -> SC.cyan; p > 0 -> SC.pink; else -> SC.ink50 })) { append(w.text) }
                if (k < words.size - 1) append(" ")
            }
        }
        Text(text, fontSize = 60.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center, lineHeight = 68.sp)
        lines.getOrNull(cur + 1)?.let { Text(it.text, fontSize = 32.sp, fontWeight = FontWeight.Bold, color = SC.ink500, textAlign = TextAlign.Center) }
    }
}

/** Scrolling melody guide: reference notes as bars, each singer's pitch as an octave-folded trail. */
@Composable
private fun PitchHud(notes: List<RefNote>, keyShift: Int, time: Double, trails: List<Triple<Color, PartySinger, List<Pair<Double, Double?>>>>, range: VocalRange?, modifier: Modifier) {
    Canvas(modifier.semantics { contentDescription = "Melody guide" }) {
        val window = 8.0; val nowX = size.width * 0.3f
        val lo = (range?.low ?: 48.0) + keyShift - 3; val hi = (range?.high ?: 72.0) + keyShift + 3
        fun x(tt: Double) = nowX + ((tt - time) / window).toFloat() * size.width
        fun y(m: Double) = size.height * (1 - ((m - lo) / maxOf(1.0, hi - lo)).toFloat())
        for (n in notes) {
            if (n.end < time - window * 0.3 || n.start > time + window) continue
            val m = n.pitch + keyShift
            drawRoundRect(if (n.end < time) SC.ink700 else SC.cyan, Offset(x(n.start), y(m) - 5f), Size(maxOf(4f, x(n.end) - x(n.start)), 10f), CornerRadius(5f))
        }
        for ((color, _, pts) in trails) {
            val path = Path(); var open = false
            for ((tt, midi) in pts) {
                if (tt <= time - window * 0.3 || tt > time) continue
                if (midi == null) { open = false; continue }
                val ref = Timing.noteAt(notes, tt)
                val m = if (ref != null) Pitch.foldTo(midi, ref + keyShift) else midi
                if (open) path.lineTo(x(tt), y(m)) else { path.moveTo(x(tt), y(m)); open = true }
            }
            drawPath(path, color, style = Stroke(width = 5f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        }
        drawRect(Color.White.copy(alpha = 0.8f), Offset(nowX - 1, 0f), Size(2f, size.height))
    }
}

@Composable
private fun ResultsView(
    results: List<Pair<PartySinger, PerformanceResult>>, message: String?, group: app.soundcheck.core.GroupScore?, next: app.soundcheck.core.QueueItem?,
    onAgain: () -> Unit, onNext: () -> Unit, onDone: () -> Unit,
) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(28.dp)) {
        Title("SoundCheck Score", 52)
        message?.let { Text(it, color = SC.danger, fontSize = 18.sp) }
        Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) { results.forEach { (s, r) -> ScoreCard(s.name, SC.hex(s.color), r) } }
        group?.let { Text("Group score · ${it.singers} singers: ${it.score} (${it.grade.name})", color = SC.pink, fontSize = 24.sp, fontWeight = FontWeight.Bold) }
        Row(horizontalArrangement = Arrangement.spacedBy(20.dp), verticalAlignment = Alignment.CenterVertically) {
            if (next != null) Button(onClick = onNext, modifier = Modifier.focusRequester(focus)) { Text("Sing next: ${next.title}") }
            if (next == null) Button(onClick = onAgain, modifier = Modifier.focusRequester(focus)) { Text("Sing again") } else OutlinedButton(onClick = onAgain) { Text("Sing again") }
            OutlinedButton(onClick = onDone) { Text("Done") }
        }
    }
}

@Composable
fun ScoreCard(name: String, color: Color, r: PerformanceResult) {
    Column(Modifier.width(420.dp).clip(RoundedCornerShape(24.dp)).background(SC.ink850).padding(28.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(name, color = color, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            Text(r.grade.name, Modifier.clip(RoundedCornerShape(10.dp)).background(SC.stage).padding(horizontal = 14.dp, vertical = 2.dp),
                fontSize = 30.sp, fontWeight = FontWeight.Black, color = SC.ink950)
        }
        Text("${r.score}", fontSize = 88.sp, fontWeight = FontWeight.Black, color = SC.ink50)
        listOf("Pitch" to r.pitch, "Timing" to r.timing, "Rhythm" to r.rhythm, "Duration" to r.duration, "Transitions" to r.transitions, "Stability" to r.stability)
            .mapNotNull { (l, v) -> v?.let { l to it } }.forEach { (label, v) ->
            Column {
                Row { Text(label.uppercase(), color = SC.ink300, fontSize = 13.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.weight(1f)); Text("${(v * 100).toInt()}", color = SC.ink300, fontSize = 13.sp) }
                Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(SC.ink700)) {
                    Box(Modifier.fillMaxWidth(v.toFloat().coerceIn(0f, 1f)).height(8.dp).background(SC.stage))
                }
            }
        }
        r.feedback.forEach { Text("• $it", color = SC.ink300, fontSize = 15.sp) }
    }
}

fun qrBitmap(text: String, size: Int = 512): Bitmap {
    val m = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size)
    val px = IntArray(size * size) { if (m[it % size, it / size]) android.graphics.Color.BLACK else android.graphics.Color.WHITE }
    return Bitmap.createBitmap(px, size, size, Bitmap.Config.ARGB_8888)
}
