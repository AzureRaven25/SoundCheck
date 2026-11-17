package app.soundcheck.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import app.soundcheck.core.PartyGuest
import app.soundcheck.core.PerformanceResult
import app.soundcheck.core.PitchDetector
import app.soundcheck.core.Platform
import app.soundcheck.core.SoundCheckBackend
import app.soundcheck.core.SoundCheckConfig
import app.soundcheck.core.TransportState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val ink950 = Color(0xFF07070B); private val ink850 = Color(0xFF14141D); private val ink500 = Color(0xFF5C5C72)
private val ink300 = Color(0xFFA3A3B8); private val ink50 = Color(0xFFF5F5FA); private val pink = Color(0xFFFF3D9A)
private val violet = Color(0xFF8B5CFF); private val gold = Color(0xFFFFC94D); private val danger = Color(0xFFFF5E5E)
private val stage = Brush.horizontalGradient(listOf(pink, violet))
private fun hex(s: String?) = runCatching { Color(android.graphics.Color.parseColor(s)) }.getOrDefault(pink)

object Services {
    val backend by lazy { SoundCheckBackend(SoundCheckConfig(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_KEY, BuildConfig.SITE_URL)) }
    val pendingCode = MutableStateFlow<String?>(null)
}

/** SoundCheck Mobile for Android: turns the phone into a wireless mic for SoundCheck Stage on the TV. */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handle(intent)
        val dev = if (BuildConfig.DEBUG) Triple(intent.getStringExtra("sc_email"), intent.getStringExtra("sc_password"), intent.getStringExtra("sc_solo")) else Triple(null, null, null)
        setContent { MaterialTheme(colorScheme = darkColorScheme(primary = pink, background = ink950)) { Home(dev) } }
    }
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); handle(intent) }
    private fun handle(i: Intent?) { codeFrom(i?.data)?.let { Services.pendingCode.value = it } }
}

/** Two tabs: Party (phone as a mic for the TV) and Sing solo (the phone plays and scores you). */
@Composable
fun Home(dev: Triple<String?, String?, String?>) {
    var tab by remember { mutableStateOf(if (dev.third != null) 1 else 0) }
    val pending by Services.pendingCode.collectAsState()
    LaunchedEffect(pending) { if (pending != null) tab = 0 }
    androidx.compose.material3.Scaffold(containerColor = ink950, bottomBar = {
        androidx.compose.material3.NavigationBar(containerColor = ink850) {
            NavigationBarItem(tab == 0, { tab = 0 }, icon = { Icon(Icons.Default.Mic, null) }, label = { Text("Party") })
            NavigationBarItem(tab == 1, { tab = 1 }, icon = { Icon(Icons.Default.MusicNote, null) }, label = { Text("Sing solo") })
        }
    }) { pad ->
        Box(Modifier.padding(pad)) { if (tab == 0) JoinFlow() else SoloHome(dev.first, dev.second, dev.third) }
    }
}

/** soundcheck://join/ABC234 or https://<site>/join/ABC234 → "ABC234". */
fun codeFrom(u: Uri?): String? {
    u ?: return null
    val seg = if (u.scheme == "soundcheck" && u.host == "join") u.pathSegments.firstOrNull()
              else u.pathSegments.indexOf("join").takeIf { it >= 0 }?.let { u.pathSegments.getOrNull(it + 1) }
    return seg?.let(::cleanCode)
}
fun cleanCode(s: String) = s.uppercase().filter { it in "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" }.take(6)

@Composable
fun JoinFlow() {
    val scope = rememberCoroutineScope()
    val ctx = LocalContext.current
    val prefs = remember { ctx.getSharedPreferences("soundcheck", 0) }
    var code by remember { mutableStateOf("") }
    var name by remember { mutableStateOf(prefs.getString("stageName", "") ?: "") }
    var joining by remember { mutableStateOf(false) }
    val guest = remember { PartyGuest(Services.backend, scope, Platform.android) }
    val st by guest.state.collectAsState()
    val pending by Services.pendingCode.collectAsState()
    LaunchedEffect(pending) { pending?.let { code = it; Services.pendingCode.value = null } }

    Box(Modifier.fillMaxSize().background(ink950).systemBarsPadding().padding(28.dp), contentAlignment = Alignment.Center) {
        if (st.joined != null) {
            MicScreen(guest, name) { scope.launch { guest.leave() } }
        } else Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Text("SOUNDCHECK PARTY", color = pink, fontWeight = FontWeight.Bold, letterSpacing = 4.sp, fontSize = 13.sp)
            Text("Join the stage", color = ink50, fontSize = 38.sp, fontWeight = FontWeight.Black)
            Text("Enter the 6-character code on the TV.", color = ink300)
            OutlinedTextField(code, { code = cleanCode(it) }, placeholder = { Text("ABC234", color = ink500) }, singleLine = true,
                textStyle = MaterialTheme.typography.headlineMedium.copy(textAlign = TextAlign.Center, letterSpacing = 8.sp, fontWeight = FontWeight.Bold, color = ink50),
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false),
                colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = ink850, focusedContainerColor = ink850, focusedBorderColor = pink),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Pairing code" })
            OutlinedTextField(name, { name = it.take(40) }, placeholder = { Text("Your stage name", color = ink500) }, singleLine = true,
                textStyle = MaterialTheme.typography.titleLarge.copy(textAlign = TextAlign.Center, color = ink50),
                colors = OutlinedTextFieldDefaults.colors(unfocusedContainerColor = ink850, focusedContainerColor = ink850, focusedBorderColor = pink),
                modifier = Modifier.fillMaxWidth().semantics { contentDescription = "Stage name" })
            Button(onClick = {
                joining = true
                prefs.edit().putString("stageName", name).apply()
                scope.launch { guest.join(code, name); joining = false }
            }, enabled = code.length == 6 && !joining, colors = ButtonDefaults.buttonColors(containerColor = Color.Transparent),
                modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(stage)) {
                Text(if (joining) "Joining…" else "Join", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 6.dp))
            }
            st.error?.let { Text(it, color = danger, textAlign = TextAlign.Center) }
        }
    }
}

private enum class MicUi { Off, Calibrating, Live, Denied }

/** Live phone-mic screen: tap → permission → calibration, then lyric line + level ring + live/final score. */
@Composable
fun MicScreen(guest: PartyGuest, name: String, leave: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val st by guest.state.collectAsState()
    var ui by remember { mutableStateOf(MicUi.Off) }
    var level by remember { mutableFloatStateOf(0f) }
    val mic = remember { MicCapture() }
    val color = hex(st.joined?.color)

    fun startMic() {
        ui = MicUi.Calibrating
        scope.launch {
            val floor = runCatching {
                mic.start { f, at -> level = ((f.rmsDb + 60) / 50).toFloat().coerceIn(0f, 1f); guest.push(f, at) }
                mic.calibrate(1500)
            }.getOrElse { ui = MicUi.Off; return@launch }
            guest.micReady(floor, mic.inputLatencyMs)
            (ctx as? ComponentActivity)?.window?.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)   // keep the screen on while singing
            ui = MicUi.Live
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) startMic() else ui = MicUi.Denied }
    DisposableEffect(Unit) { onDispose { mic.stop() } }
    LaunchedEffect(ui) { while (ui == MicUi.Live && isActive) { guest.refreshLine(); delay(200) } }

    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(22.dp)) {
        val r = st.result
        if (r != null) ScoreCard(name.ifBlank { "You" }, color, r)
        else {
            Text(when (st.transport) { TransportState.playing -> "LIVE"; TransportState.paused -> "PAUSED"; else -> "WAITING FOR THE SONG" },
                color = ink500, fontWeight = FontWeight.Bold, letterSpacing = 3.sp, fontSize = 13.sp)
            Text(st.line, color = ink50, fontSize = 28.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, modifier = Modifier.heightIn(min = 100.dp))
            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(190.dp).clip(CircleShape)
                .background(if (ui == MicUi.Live) color.copy(alpha = 0.18f) else color)
                .semantics { contentDescription = if (ui == MicUi.Live) "Microphone on" else "Turn on my microphone" }) {
                if (ui == MicUi.Live) Box(Modifier.fillMaxSize().scale(0.6f + level * 0.4f).clip(CircleShape).background(color.copy(alpha = 0.45f)))
                TextButton(onClick = {
                    if (ui != MicUi.Off && ui != MicUi.Denied) return@TextButton
                    if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startMic()
                    else permission.launch(Manifest.permission.RECORD_AUDIO)
                }, modifier = Modifier.fillMaxSize()) {
                    Icon(if (st.muted) Icons.Default.MicOff else Icons.Default.Mic, null, tint = if (ui == MicUi.Live) Color.White else ink950, modifier = Modifier.size(64.dp))
                }
            }
            Text(when (ui) { MicUi.Off -> "Tap to turn on your mic"; MicUi.Calibrating -> "Stay quiet for a second…"; MicUi.Denied -> "Allow microphone access to sing."; MicUi.Live -> "" },
                color = if (ui == MicUi.Denied) danger else ink500)
            st.hitRate?.let { Text("On pitch ${(it * 100).toInt()}%", color = ink50, fontSize = 24.sp, fontWeight = FontWeight.Bold) }
            if (st.muted) Text("The host muted your mic", color = gold)
        }
        TextButton(onClick = { mic.stop(); leave() }) { Text("Leave", color = danger, fontSize = 18.sp) }
    }
}

@Composable
fun ScoreCard(name: String, color: Color, r: PerformanceResult) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(ink850).padding(24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("SOUNDCHECK SCORE", color = ink300, fontSize = 12.sp, letterSpacing = 3.sp, fontWeight = FontWeight.Bold)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(name, color = color, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))
            Text(r.grade.name, Modifier.clip(RoundedCornerShape(10.dp)).background(stage).padding(horizontal = 12.dp, vertical = 2.dp), fontSize = 28.sp, fontWeight = FontWeight.Black, color = ink950)
        }
        Text("${r.score}", fontSize = 80.sp, fontWeight = FontWeight.Black, color = ink50)
        listOf("Pitch" to r.pitch, "Timing" to r.timing, "Rhythm" to r.rhythm, "Stability" to r.stability).forEach { (label, v) ->
            Row { Text(label.uppercase(), color = ink300, fontSize = 12.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.weight(1f)); Text("${(v * 100).toInt()}", color = ink300, fontSize = 12.sp) }
            Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(Color(0xFF2A2A38))) {
                Box(Modifier.fillMaxWidth(v.toFloat().coerceIn(0f, 1f)).height(8.dp).background(stage))
            }
        }
        r.feedback.forEach { Text("• $it", color = ink300, fontSize = 14.sp) }
    }
}

/**
 * Microphone → pitch frames: AudioRecord (VOICE_RECOGNITION source) with the platform echo canceller and noise
 * suppressor when available, analysed by the same YIN detector as every other SoundCheck client.
 */
class MicCapture {
    private var record: AudioRecord? = null
    @Volatile private var running = false
    private val listeners = java.util.concurrent.CopyOnWriteArrayList<(app.soundcheck.core.PitchFrame, Double) -> Unit>()
    var inputLatencyMs = 0.0; private set

    @SuppressLint("MissingPermission")   // callers check RECORD_AUDIO first
    suspend fun start(onFrame: (app.soundcheck.core.PitchFrame, Double) -> Unit) = withContext(Dispatchers.Default) {
        val sr = 48_000
        val minBuf = AudioRecord.getMinBufferSize(sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
        val rec = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT, maxOf(minBuf, 4096))
        if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(rec.audioSessionId)?.enabled = true
        if (NoiseSuppressor.isAvailable()) NoiseSuppressor.create(rec.audioSessionId)?.enabled = true
        record = rec
        listeners.add(onFrame)
        val chunk = 480                       // 10 ms
        inputLatencyMs = 1000.0 * maxOf(minBuf / 4, chunk) / sr
        rec.startRecording()
        running = true
        Thread({
            val det = PitchDetector(sr.toDouble())
            val buf = FloatArray(chunk)
            while (running) {
                val n = rec.read(buf, 0, chunk, AudioRecord.READ_BLOCKING)
                if (n <= 0) continue
                val at = System.currentTimeMillis() - inputLatencyMs
                det.process(buf, n) { f -> listeners.forEach { it(f, at) } }
            }
        }, "soundcheck-mic").start()
    }

    /** Measure the room for `ms` while the singer is silent; returns the noise floor (dBFS). */
    suspend fun calibrate(ms: Long): Double {
        val levels = java.util.Collections.synchronizedList(mutableListOf<Double>())
        val l: (app.soundcheck.core.PitchFrame, Double) -> Unit = { f, _ -> levels += f.rmsDb }
        listeners.add(l); delay(ms); listeners.remove(l)
        return PitchDetector.noiseFloor(synchronized(levels) { levels.toList() })
    }

    fun stop() {
        running = false
        listeners.clear()
        runCatching { record?.stop() }; runCatching { record?.release() }
        record = null
    }
}
