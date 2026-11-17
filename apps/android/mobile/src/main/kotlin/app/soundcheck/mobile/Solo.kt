package app.soundcheck.mobile

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import app.soundcheck.core.LyricLine
import app.soundcheck.core.PerformanceResult
import app.soundcheck.core.Pitch
import app.soundcheck.core.PitchDetector
import app.soundcheck.core.PitchFrame
import app.soundcheck.core.RefNote
import app.soundcheck.core.ScoreSinger
import app.soundcheck.core.StageData
import app.soundcheck.core.StageLoad
import app.soundcheck.core.Timing
import app.soundcheck.core.Track
import kotlinx.coroutines.launch

private val ink950 = Color(0xFF07070B); private val ink900 = Color(0xFF0E0E15); private val ink700 = Color(0xFF2A2A38)
private val ink500 = Color(0xFF5C5C72); private val ink300 = Color(0xFFA3A3B8); private val ink50 = Color(0xFFF5F5FA)
private val pink = Color(0xFFFF3D9A); private val cyan = Color(0xFF38E1FF); private val gold = Color(0xFFFFC94D); private val danger = Color(0xFFFF5E5E)

/** Solo singing on the phone: your karaoke-ready songs, played on the phone with its own mic scoring you. */
@Composable
fun SoloHome(devEmail: String?, devPassword: String?, devTrack: String?) {
    val backend = Services.backend
    val scope = rememberCoroutineScope()
    var signedIn by remember { mutableStateOf(false) }
    var songs by remember { mutableStateOf<List<Track>?>(null) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var singing by remember { mutableStateOf<String?>(null) }
    suspend fun refresh() {
        signedIn = backend.hasAccount
        if (signedIn) songs = runCatching { backend.karaokeReady() }.getOrDefault(emptyList())
    }
    LaunchedEffect(Unit) {
        backend.awaitSession()
        if (BuildConfig.DEBUG && devEmail != null && devPassword != null && !backend.hasAccount)
            runCatching { backend.signIn(devEmail, devPassword) }
        refresh()
        if (BuildConfig.DEBUG && signedIn && devTrack != null) singing = devTrack
    }
    singing?.let { SoloStage(it) { singing = null }; return }
    Column(Modifier.fillMaxSize().background(ink950).padding(24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Sing solo", color = ink50, fontSize = 34.sp, fontWeight = FontWeight.Black)
        if (!signedIn) {
            Text("Sign in to sing the songs you’ve made karaoke-ready on SoundCheck.", color = ink300)
            OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
            Button(onClick = { scope.launch { runCatching { backend.signIn(email, password) }.onFailure { error = it.message }; refresh() } },
                colors = ButtonDefaults.buttonColors(containerColor = pink), modifier = Modifier.fillMaxWidth()) { Text("Sign in") }
            error?.let { Text(it, color = danger) }
        } else when {
            songs == null -> Text("Loading…", color = ink300)
            songs!!.isEmpty() -> Text("No karaoke-ready songs yet. Upload your copy of a song on the SoundCheck website.", color = ink300)
            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(songs!!, key = { it.id }) { t ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(ink900).clickable { singing = t.id }.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(t.title, color = ink50, fontWeight = FontWeight.Bold); Text(t.artistCredit, color = ink300, fontSize = 14.sp) }
                        Icon(Icons.Default.MusicNote, contentDescription = "Sing ${t.title}", tint = pink)
                    }
                }
            }
        }
    }
}

private enum class SoloPhase { Loading, Ready, Calibrating, Singing, Scoring, Results }

@Composable
fun SoloStage(trackId: String, onExit: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val backend = Services.backend
    val engine = remember { StageEngine(ctx) }
    val mic = remember { MicCapture() }
    val frames = remember { java.util.Collections.synchronizedList(mutableListOf<Double>()) }
    val trail = remember { java.util.Collections.synchronizedList(mutableListOf<Pair<Double, Double?>>()) }
    var phase by remember { mutableStateOf(SoloPhase.Loading) }
    var data by remember { mutableStateOf<StageData?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var keyShift by remember { mutableIntStateOf(0) }
    var noiseFloor by remember { mutableStateOf<Double?>(null) }
    var result by remember { mutableStateOf<PerformanceResult?>(null) }
    var t by remember { mutableDoubleStateOf(0.0) }
    DisposableEffect(Unit) { onDispose { engine.release(); mic.stop() } }
    BackHandler(onBack = onExit)

    suspend fun finish() {
        if (phase != SoloPhase.Singing) return
        engine.pause(); mic.stop()
        val all = synchronized(frames) { frames.toList() }
        if (all.size / 4 < 100) { message = "We didn’t capture enough singing to score."; phase = SoloPhase.Results; return }
        phase = SoloPhase.Scoring
        runCatching { backend.score(trackId, null, keyShift, listOf(ScoreSinger(null, all, 0.0, noiseFloor))) }
            .onSuccess { result = it.firstOrNull()?.asResult() }.onFailure { message = "Scoring failed. Please try again." }
        phase = SoloPhase.Results
    }

    fun start() {
        val d = data ?: return
        phase = SoloPhase.Loading
        scope.launch {
            runCatching {
                mic.start { f: PitchFrame, capturedAt: Double ->
                    if (!engine.isPlayingAnyThread) return@start
                    val st = engine.positionAnyThread() - (System.currentTimeMillis() - capturedAt) / 1000
                    frames.addAll(listOf(Math.round(st * 1000) / 1000.0, f.f0, f.conf, f.rmsDb))
                    trail.add(st to (if (PitchDetector.isVoiced(f, noiseFloor)) Pitch.midi(f.f0) else null))
                    if (trail.size > 400) synchronized(trail) { trail.subList(0, trail.size - 400).clear() }
                }
                if (!engine.loaded) { engine.load(d.instrumentalUrl, d.vocalsUrl); engine.onEnded = { scope.launch { finish() } } }
                phase = SoloPhase.Calibrating
                noiseFloor = mic.calibrate(1500)
                frames.clear(); trail.clear()
                engine.setKey(keyShift); engine.play(0.0)
                phase = SoloPhase.Singing
            }.onFailure { message = "Couldn’t start: ${it.message}"; phase = SoloPhase.Ready }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) start() else message = "Allow microphone access to be scored." }

    LaunchedEffect(trackId) {
        runCatching { backend.stageData(trackId) }.onSuccess { r ->
            if (r is StageLoad.Ready) { data = r.data; phase = SoloPhase.Ready } else message = "This song isn’t karaoke-ready."
        }.onFailure { message = it.message }
    }
    LaunchedEffect(phase) { while (phase == SoloPhase.Singing) withFrameNanos { t = engine.position() } }

    Box(Modifier.fillMaxSize().background(ink950).padding(20.dp), contentAlignment = Alignment.Center) {
        val d = data
        when (phase) {
            SoloPhase.Loading -> Text(message ?: "Warming up the band…", color = ink300)
            SoloPhase.Ready -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Text(d?.track?.title ?: "", color = ink50, fontSize = 30.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center)
                Text("Use headphones for the best score, so the mic hears only you.", color = ink300, textAlign = TextAlign.Center)
                Button(onClick = {
                    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start()
                    else permission.launch(Manifest.permission.RECORD_AUDIO)
                }, colors = ButtonDefaults.buttonColors(containerColor = pink)) { Text("Start singing", fontSize = 18.sp) }
                message?.let { Text(it, color = danger) }
            }
            SoloPhase.Calibrating -> Text("Stay quiet for a moment…", color = ink300)
            SoloPhase.Singing -> if (d != null) Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
                MiniHud(d.notes, keyShift, t, synchronized(trail) { trail.toList() }, Modifier.fillMaxWidth().height(140.dp).clip(RoundedCornerShape(16.dp)).background(ink900))
                Spacer(Modifier.weight(1f))
                MiniLyrics(d.lines, d.notes, t)
                Spacer(Modifier.weight(1f))
                Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = { keyShift = (keyShift - 1).coerceAtLeast(-6); engine.setKey(keyShift) }) { Text("Key −") }
                    Text(if (keyShift > 0) "+$keyShift" else "$keyShift", color = ink50, fontWeight = FontWeight.Bold)
                    OutlinedButton(onClick = { keyShift = (keyShift + 1).coerceAtMost(6); engine.setKey(keyShift) }) { Text("Key +") }
                    Button(onClick = { scope.launch { finish() } }) { Text("Finish") }
                }
            }
            SoloPhase.Scoring -> Text("Scoring…", color = ink300)
            SoloPhase.Results -> Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                result?.let { ScoreCard("You", gold, it) } ?: Text(message ?: "", color = ink300)
                TextButton(onClick = onExit) { Text("Done", color = ink50, fontSize = 18.sp) }
            }
        }
    }
}

@Composable
private fun MiniLyrics(lines: List<LyricLine>, notes: List<RefNote>, t: Double) {
    val i = Timing.lineAt(lines, t); val cur = maxOf(0, i)
    if (lines.isEmpty()) { Text("♪", color = ink300, fontSize = 40.sp); return }
    val words = Timing.wordsOf(lines[cur], lines.getOrNull(cur + 1), notes)
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(buildAnnotatedString {
            words.forEachIndexed { k, w ->
                val p = if (i < 0) 0.0 else Timing.progress(w, t)
                withStyle(SpanStyle(color = when { p >= 1 -> cyan; p > 0 -> pink; else -> ink50 })) { append(w.text) }
                if (k < words.size - 1) append(" ")
            }
        }, fontSize = 32.sp, fontWeight = FontWeight.Black, textAlign = TextAlign.Center, lineHeight = 38.sp)
        lines.getOrNull(cur + 1)?.let { Text(it.text, color = ink500, fontSize = 18.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center) }
    }
}

@Composable
private fun MiniHud(notes: List<RefNote>, keyShift: Int, time: Double, trail: List<Pair<Double, Double?>>, modifier: Modifier) {
    Canvas(modifier.semantics { contentDescription = "Melody guide" }) {
        val window = 6.0; val nowX = size.width * 0.3f
        val lo = (notes.minOfOrNull { it.pitch } ?: 48.0) + keyShift - 3; val hi = (notes.maxOfOrNull { it.pitch } ?: 72.0) + keyShift + 3
        fun x(tt: Double) = nowX + ((tt - time) / window).toFloat() * size.width
        fun y(m: Double) = size.height * (1 - ((m - lo) / maxOf(1.0, hi - lo)).toFloat())
        for (n in notes) {
            if (n.end < time - window * 0.3 || n.start > time + window) continue
            drawRoundRect(if (n.end < time) ink700 else cyan, Offset(x(n.start), y(n.pitch + keyShift) - 4f), Size(maxOf(4f, x(n.end) - x(n.start)), 8f), CornerRadius(4f))
        }
        val path = Path(); var open = false
        for ((tt, midi) in trail) {
            if (tt <= time - window * 0.3 || tt > time || midi == null) { open = false; continue }
            val ref = Timing.noteAt(notes, tt)
            val m = if (ref != null) Pitch.foldTo(midi, ref + keyShift) else midi
            if (open) path.lineTo(x(tt), y(m)) else { path.moveTo(x(tt), y(m)); open = true }
        }
        drawPath(path, gold, style = Stroke(width = 5f))
        drawRect(Color.White.copy(alpha = 0.8f), Offset(nowX - 1, 0f), Size(2f, size.height))
    }
}
