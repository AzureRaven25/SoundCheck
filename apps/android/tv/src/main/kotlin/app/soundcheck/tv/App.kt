package app.soundcheck.tv

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.MaterialTheme
import androidx.tv.material3.Tab
import androidx.tv.material3.TabRow
import androidx.tv.material3.Text
import androidx.tv.material3.darkColorScheme
import app.soundcheck.core.SoundCheckBackend
import app.soundcheck.core.SoundCheckConfig
import app.soundcheck.core.Track

/** SoundCheck design tokens (mirror of the web @theme and SoundCheckUI). */
object SC {
    val ink950 = Color(0xFF07070B); val ink900 = Color(0xFF0E0E15); val ink850 = Color(0xFF14141D); val ink800 = Color(0xFF1B1B26)
    val ink700 = Color(0xFF2A2A38); val ink500 = Color(0xFF5C5C72); val ink300 = Color(0xFFA3A3B8); val ink50 = Color(0xFFF5F5FA)
    val pink = Color(0xFFFF3D9A); val violet = Color(0xFF8B5CFF); val cyan = Color(0xFF38E1FF); val gold = Color(0xFFFFC94D)
    val success = Color(0xFF3DDC97); val danger = Color(0xFFFF5E5E)
    val stage = Brush.horizontalGradient(listOf(pink, violet))
    fun hex(s: String) = runCatching { Color(android.graphics.Color.parseColor(s)) }.getOrDefault(pink)
}

object Services {
    val backend by lazy { SoundCheckBackend(SoundCheckConfig(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_KEY, BuildConfig.SITE_URL)) }
}

/**
 * SoundCheck for Fire TV / Android TV: browse, preview, and host SoundCheck Stage / Party with phones as mics.
 * Debug builds accept `adb shell am start -n app.soundcheck.tv/.MainActivity --es sc_email … --es sc_password …
 * --es sc_stage <trackId> --ez sc_autostart true` so emulator tests needn't type on the TV keyboard.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val dev = if (BuildConfig.DEBUG) DevLaunch(
            intent.getStringExtra("sc_email"), intent.getStringExtra("sc_password"),
            intent.getStringExtra("sc_stage"), intent.getBooleanExtra("sc_autostart", false),
        ) else DevLaunch()
        setContent { SoundCheckTv(dev) }
    }
}

data class DevLaunch(val email: String? = null, val password: String? = null, val stage: String? = null, val autostart: Boolean = false)

@Composable
fun SoundCheckTv(dev: DevLaunch) {
    val backend = Services.backend
    var signedIn by remember { mutableStateOf(false) }
    var tab by remember { mutableIntStateOf(0) }
    var detail by remember { mutableStateOf<Track?>(null) }
    var stage by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        backend.awaitSession()
        if (dev.email != null && dev.password != null && !backend.isSignedIn) runCatching { backend.signIn(dev.email, dev.password) }
        signedIn = backend.isSignedIn
        if (dev.stage != null && signedIn) stage = dev.stage
    }
    MaterialTheme(colorScheme = darkColorScheme(primary = SC.pink, background = SC.ink950, surface = SC.ink900)) {
        Box(Modifier.fillMaxSize().background(SC.ink950)) {
            when {
                stage != null -> StageScreen(stage!!, autostart = dev.autostart, onExit = { stage = null })
                detail != null -> TrackDetail(detail!!, signedIn, onSing = { stage = it.id }, onBack = { detail = null })
                else -> Column(Modifier.fillMaxSize()) {
                    TabRow(selectedTabIndex = tab, modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 24.dp)) {
                        listOf("Home", "Search", "Account").forEachIndexed { i, label ->
                            Tab(selected = tab == i, onFocus = { tab = i }) { Text(label, Modifier.padding(horizontal = 20.dp, vertical = 8.dp), fontSize = 18.sp) }
                        }
                    }
                    when (tab) {
                        0 -> HomeScreen(signedIn, onOpen = { detail = it })
                        1 -> SearchScreen(onOpen = { detail = it })
                        else -> AccountScreen(signedIn) { signedIn = backend.isSignedIn }
                    }
                }
            }
        }
    }
}

@Composable
fun Title(text: String, size: Int = 40) = Text(text, fontSize = size.sp, fontWeight = FontWeight.Black, color = SC.ink50)
