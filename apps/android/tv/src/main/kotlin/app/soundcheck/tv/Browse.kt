package app.soundcheck.tv

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.ExoPlayer
import androidx.tv.material3.Button
import androidx.tv.material3.Card
import androidx.tv.material3.OutlinedButton
import androidx.tv.material3.Text
import app.soundcheck.core.Track
import coil3.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

private val artworkLookups = Semaphore(4)   // providers are rate limited, like the web's 4-at-a-time queue
private val artworkCache = mutableMapOf<String, String?>()

/** Album art with a gradient monogram fallback; resolves missing artwork on demand. */
@Composable
fun Artwork(track: Track, modifier: Modifier = Modifier) {
    var url by remember(track.id) { mutableStateOf(track.artworkUrl ?: track.albumId?.let { artworkCache[it] }) }
    LaunchedEffect(track.id) {
        val album = track.albumId ?: return@LaunchedEffect
        if (url != null || artworkCache.containsKey(album)) return@LaunchedEffect
        url = artworkLookups.withPermit { Services.backend.resolveArtwork(album) }.also { artworkCache[album] = it }
    }
    Box(modifier.aspectRatio(1f).clip(RoundedCornerShape(12.dp)).background(SC.stage), contentAlignment = Alignment.Center) {
        Text(track.title.split(" ").take(2).mapNotNull { it.firstOrNull()?.uppercase() }.joinToString(""), fontSize = 26.sp, fontWeight = FontWeight.Black, color = SC.ink50)
        if (url != null) AsyncImage(url, contentDescription = "${track.title} artwork", contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}

@Composable
fun TrackCard(t: Track, onOpen: (Track) -> Unit) {
    Column(Modifier.width(200.dp)) {
        Card(onClick = { onOpen(t) }, modifier = Modifier.size(200.dp)) { Artwork(t, Modifier.fillMaxSize()) }
        Spacer(Modifier.height(10.dp))
        Text(t.title, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, color = SC.ink50)
        Text(t.artistCredit, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = SC.ink300)
    }
}

@Composable
fun HomeScreen(signedIn: Boolean, onOpen: (Track) -> Unit) {
    var ready by remember { mutableStateOf(emptyList<Track>()) }
    var popular by remember { mutableStateOf(emptyList<Track>()) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(signedIn) {
        runCatching {
            popular = Services.backend.popular(40)
            ready = if (signedIn) Services.backend.karaokeReady() else emptyList()
        }.onFailure { error = "Couldn’t load the catalog: ${it.message}" }
    }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 56.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 24.dp)) {
                Title("SoundCheck", 44)
                Spacer(Modifier.width(14.dp))
                Text("STAGE", Modifier.clip(RoundedCornerShape(50)).background(SC.stage).padding(horizontal = 12.dp, vertical = 4.dp), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = SC.ink50)
            }
        }
        if (ready.isNotEmpty()) item { TrackRow("Ready to sing", ready, onOpen) }
        item { TrackRow("Popular right now", popular, onOpen) }
        error?.let { item { Text(it, color = SC.danger) } }
    }
}

@Composable
fun TrackRow(title: String, tracks: List<Track>, onOpen: (Track) -> Unit) {
    Column {
        Text(title, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = SC.ink50)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(24.dp), contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 16.dp)) {
            items(tracks, key = { it.id }) { TrackCard(it, onOpen) }
        }
    }
}

@Composable
fun Field(value: String, onChange: (String) -> Unit, placeholder: String, password: Boolean = false, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(SC.ink850).padding(horizontal = 18.dp, vertical = 14.dp)) {
        if (value.isEmpty()) Text(placeholder, color = SC.ink500, fontSize = 20.sp)
        BasicTextField(value, onChange, singleLine = true, textStyle = TextStyle(color = SC.ink50, fontSize = 20.sp), cursorBrush = SolidColor(SC.pink),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else KeyboardType.Text), modifier = Modifier.fillMaxWidth())
    }
}

@Composable
fun SearchScreen(onOpen: (Track) -> Unit) {
    var q by remember { mutableStateOf("") }
    var results by remember { mutableStateOf(emptyList<Track>()) }
    var searching by remember { mutableStateOf(false) }
    LaunchedEffect(q) {
        val query = q.trim()
        if (query.length < 2) { results = emptyList(); return@LaunchedEffect }
        delay(350)   // debounce
        searching = true
        results = runCatching { Services.backend.search(query) }.getOrDefault(emptyList())
        searching = false
    }
    Column(Modifier.fillMaxSize().padding(horizontal = 56.dp, vertical = 24.dp)) {
        Field(q, { q = it }, "Songs, artists, albums", modifier = Modifier.width(640.dp))
        Spacer(Modifier.height(20.dp))
        if (searching) Text("Searching…", color = SC.ink300)
        if (!searching && results.isEmpty() && q.length >= 2) Text("No songs found", color = SC.ink300)
        LazyVerticalGrid(GridCells.Adaptive(200.dp), horizontalArrangement = Arrangement.spacedBy(24.dp), verticalArrangement = Arrangement.spacedBy(28.dp)) {
            items(results, key = { it.id }) { TrackCard(it, onOpen) }
        }
    }
}

@Composable
fun TrackDetail(track: Track, signedIn: Boolean, onSing: (Track) -> Unit, onBack: () -> Unit, autoplay: Boolean = false) {
    val ctx = LocalContext.current
    var ready by remember { mutableStateOf(false) }
    var previewLabel by remember { mutableStateOf("Play") }
    var sourceLabel by remember { mutableStateOf<String?>(null) }
    val player = remember { ExoPlayer.Builder(ctx).build() }
    val scope = rememberCoroutineScope()
    DisposableEffect(Unit) { onDispose { player.release() } }
    LaunchedEffect(track.id) { ready = signedIn && Services.backend.isKaraokeReady(track.id) }
    if (BuildConfig.DEBUG && autoplay) LaunchedEffect(Unit) {   // emulator tests: play straight away and log the position
        val src = Services.backend.listenSource(track.id) ?: return@LaunchedEffect
        sourceLabel = (if (src.full) "Full track · " else "") + src.label
        player.setMediaItem(MediaItem.fromUri(src.url)); player.prepare(); player.play(); previewLabel = "Pause"
        repeat(8) { delay(10_000); println("[soundcheck] listen pos=${player.currentPosition / 1000}s dur=${player.duration / 1000}s playing=${player.isPlaying} full=${src.full}") }
    }
    androidx.activity.compose.BackHandler(onBack = onBack)
    Row(Modifier.fillMaxSize().padding(64.dp), horizontalArrangement = Arrangement.spacedBy(56.dp)) {
        Artwork(track, Modifier.size(420.dp))
        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Title(track.title, 48)
            Text(track.artistCredit, fontSize = 24.sp, color = SC.ink300)
            Text(listOfNotNull(track.albumTitle, track.releaseYear?.toString(), track.durationText.ifEmpty { null }).joinToString("  ·  "), color = SC.ink500, fontSize = 18.sp)
            Spacer(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                if (ready) Button(onClick = { onSing(track) }) { Text("Sing on Stage") }
                OutlinedButton(onClick = {
                    if (player.isPlaying) { player.pause(); previewLabel = "Play"; return@OutlinedButton }
                    if (player.mediaItemCount > 0) { player.play(); previewLabel = "Pause"; return@OutlinedButton }
                    previewLabel = "Loading…"
                    scope.launch {
                        val src = Services.backend.listenSource(track.id)
                        if (src == null) { previewLabel = "Not available"; return@launch }
                        sourceLabel = (if (src.full) "Full track · " else "") + src.label
                        player.setMediaItem(MediaItem.fromUri(src.url)); player.prepare(); player.play()
                        previewLabel = "Pause"
                    }
                }) { Text(previewLabel) }
            }
            if (!ready) Text(if (signedIn) "Karaoke tracks for this song aren’t ready yet. Upload your copy on the SoundCheck website to sing it here."
                             else "Sign in on the Account tab to sing your karaoke-ready songs.", color = SC.ink300, modifier = Modifier.width(640.dp))
            sourceLabel?.let { Text(it, color = SC.ink300, fontSize = 14.sp) }
        }
    }
}

@Composable
fun AccountScreen(signedIn: Boolean, onChanged: () -> Unit) {
    val backend = Services.backend
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var useEmail by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().padding(64.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        if (!signedIn && !useEmail) {
            PhoneSignIn(onSignedIn = onChanged)
            OutlinedButton(onClick = { useEmail = true }) { Text("Use email and password instead") }
            return@Column
        }
        if (signedIn) {
            Title("Signed in as ${backend.displayName}", 32)
            Button(onClick = { scope.launch { runCatching { backend.signOut() }; onChanged() } }) { Text("Sign out") }
        } else {
            Title(if (creating) "Create your SoundCheck account" else "Sign in to SoundCheck", 36)
            if (creating) Field(name, { name = it }, "Display name", modifier = Modifier.width(640.dp))
            Field(email, { email = it }, "Email", modifier = Modifier.width(640.dp))
            Field(password, { password = it }, "Password", password = true, modifier = Modifier.width(640.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Button(enabled = !busy, onClick = {
                    busy = true; error = null
                    scope.launch {
                        runCatching { if (creating) backend.signUp(email, password, name.ifBlank { "Singer" }) else backend.signIn(email, password) }
                            .onFailure { error = it.message }
                        busy = false; onChanged()
                    }
                }) { Text(if (busy) "Please wait…" else if (creating) "Sign up" else "Sign in") }
                OutlinedButton(onClick = { creating = !creating }) { Text(if (creating) "I have an account" else "Create an account") }
                OutlinedButton(onClick = { useEmail = false }) { Text("Sign in with your phone") }
            }
            error?.let { Text(it, color = SC.danger) }
        }
    }
}


/** Sign in on the TV with your phone: show a code + QR, the phone approves it at /activate, the TV polls. */
@Composable
fun PhoneSignIn(onSignedIn: () -> Unit) {
    var session by remember { mutableStateOf<app.soundcheck.core.SoundCheckBackend.DeviceSignIn?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) {
        while (true) {   // start, then poll; a fresh code is issued when one expires
            val s = runCatching { Services.backend.startDeviceSignIn(app.soundcheck.core.Platform.firetv) }.getOrElse {
                error = "Can’t reach SoundCheck. Retrying…"; delay(5000); null
            } ?: continue
            session = s; error = null
            while (true) {
                delay(s.interval * 1000L)
                when (runCatching { Services.backend.pollDeviceSignIn(s) }.getOrDefault(app.soundcheck.core.SoundCheckBackend.DevicePoll.Pending)) {
                    app.soundcheck.core.SoundCheckBackend.DevicePoll.Pending -> continue
                    app.soundcheck.core.SoundCheckBackend.DevicePoll.SignedIn -> { onSignedIn(); return@LaunchedEffect }
                    app.soundcheck.core.SoundCheckBackend.DevicePoll.Expired -> break
                }
            }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(56.dp), verticalAlignment = Alignment.CenterVertically) {
        session?.let { s ->
            val qr = remember(s.userCode) { qrBitmap(s.activateUrl) }
            androidx.compose.foundation.Image(qr.asImageBitmap(), contentDescription = "QR code to sign in",
                modifier = Modifier.size(280.dp).clip(RoundedCornerShape(20.dp)).background(androidx.compose.ui.graphics.Color.White).padding(14.dp))
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Title("Sign in with your phone", 40)
            val s = session
            if (s == null) Text("Getting a code…", color = SC.ink300)
            else {
                Text("Scan the code, or open ${s.verificationUrl.removePrefix("https://").removePrefix("http://")} on a signed-in phone and enter", color = SC.ink300, fontSize = 18.sp)
                Text(s.userCode.toCharArray().joinToString(" "), fontSize = 80.sp, fontWeight = FontWeight.Black, color = SC.ink50)
            }
            error?.let { Text(it, color = SC.danger) }
        }
    }
}
