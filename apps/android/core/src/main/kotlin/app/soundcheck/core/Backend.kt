package app.soundcheck.core

import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.functions.Functions
import io.github.jan.supabase.functions.functions
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.from
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.query.Columns
import io.github.jan.supabase.postgrest.query.Order
import io.github.jan.supabase.realtime.Realtime
import io.github.jan.supabase.storage.Storage
import io.github.jan.supabase.storage.storage
import io.ktor.client.statement.bodyAsText
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlin.time.Duration.Companion.hours

/** Client configuration. Only the *publishable* key ships in an app; the secret key stays server-side. */
data class SoundCheckConfig(val supabaseUrl: String, val publishableKey: String, val siteUrl: String)

sealed interface StageLoad {
    data class Ready(val data: StageData) : StageLoad
    data class NotReady(val title: String) : StageLoad
    data object SignedOut : StageLoad
}

data class SessionInfo(val id: String, val code: String)
data class JoinInfo(val sessionId: String, val memberId: String, val color: String)
data class ScoreSinger(val memberId: String?, val frames: List<Double>, val latencyMs: Double?, val noiseFloorDb: Double?)

/** A song request in a party's queue. */
@Serializable
data class QueueItem(
    val id: String, @SerialName("track_id") val trackId: String, val title: String,
    @SerialName("artist_credit") val artistCredit: String, @SerialName("requester_name") val requesterName: String? = null, val status: String,
)

@Serializable
data class ScoredSinger(
    @SerialName("member_id") val memberId: String? = null,
    @SerialName("performance_id") val performanceId: String? = null,
    val score: Int, val grade: Grade, val pitch: Double, val timing: Double, val rhythm: Double, val stability: Double,
    val feedback: List<String>, val duration: Double? = null, val transitions: Double? = null,
) {
    fun asResult() = PerformanceResult(memberId ?: "", performanceId, score, grade, pitch, timing, rhythm, stability, feedback, duration, transitions)
}

/**
 * One Supabase client per app plus typed helpers for every backend call the Android apps make (mirror of
 * SoundCheckKit's SoundCheckBackend and the web). Business rules live in Postgres (RLS + RPCs) and Edge Functions.
 */
class SoundCheckBackend(val config: SoundCheckConfig) {
    val client: SupabaseClient = createSupabaseClient(config.supabaseUrl, config.publishableKey) {
        defaultSerializer = io.github.jan.supabase.serializer.KotlinXSerializer(SCProtocol.json)
        install(Auth); install(Postgrest); install(Realtime); install(Functions); install(Storage)
    }
    private val json = SCProtocol.json

    // Auth
    val isSignedIn get() = client.auth.currentUserOrNull() != null
    val userId get() = client.auth.currentUserOrNull()?.id
    /** Signed in with a real account (not an anonymous party guest). */
    val hasAccount get() = client.auth.currentUserOrNull()?.email?.isNotEmpty() == true
    suspend fun awaitSession() { client.auth.awaitInitialization() }
    suspend fun signIn(email: String, password: String) { client.auth.signInWith(Email) { this.email = email; this.password = password } }
    suspend fun signUp(email: String, password: String, displayName: String) {
        client.auth.signUpWith(Email) { this.email = email; this.password = password; data = buildJsonObject { put("display_name", displayName) } }
    }
    /** Phones that join a party without an account become anonymous users (real auth.uid() for RLS). */
    suspend fun ensureSignedIn(displayName: String) {
        if (!isSignedIn) client.auth.signInAnonymously(data = buildJsonObject { put("display_name", displayName) })
    }
    /** Signs out this device only (a global sign-out would also sign out your TV or phone). */
    suspend fun signOut() = client.auth.signOut(io.github.jan.supabase.auth.SignOutScope.LOCAL)

    /**
     * Confirms the stored session is still live on the server (it can be revoked elsewhere). Database reads only
     * check the token's signature, so a revoked session would otherwise surface later as failed scoring.
     * Returns false — and clears the stale session — when it was revoked.
     */
    suspend fun validateSession(): Boolean {
        if (!isSignedIn) return false
        return runCatching { client.auth.retrieveUserForCurrentSession(updateSession = true); true }.getOrElse { e ->
            if (e is java.io.IOException || e is io.ktor.client.plugins.HttpRequestTimeoutException) return true   // offline: keep it
            runCatching { client.auth.signOut(io.github.jan.supabase.auth.SignOutScope.LOCAL) }
            false
        }
    }

    /** TV sign-in with a phone (device-auth Edge Function): show userCode, then poll until approved. */
    @Serializable
    data class DeviceSignIn(
        @SerialName("device_code") val deviceCode: String, @SerialName("user_code") val userCode: String,
        @SerialName("verification_url") val verificationUrl: String, @SerialName("expires_in") val expiresIn: Int, val interval: Int,
    ) { val activateUrl get() = "$verificationUrl?code=$userCode" }
    enum class DevicePoll { Pending, Expired, SignedIn }

    suspend fun startDeviceSignIn(platform: Platform): DeviceSignIn =
        json.decodeFromJsonElement(invoke("device-auth", buildJsonObject { put("action", "start"); put("platform", platform.name) }))

    /** One poll; on approval exchanges the one-time token for a session on this device. */
    suspend fun pollDeviceSignIn(s: DeviceSignIn): DevicePoll {
        val r = invoke("device-auth", buildJsonObject { put("action", "poll"); put("device_code", s.deviceCode) })
        return when (r["status"]?.jsonPrimitive?.content) {
            "approved" -> {
                val hash = r["token_hash"]?.jsonPrimitive?.content ?: return DevicePoll.Expired
                client.auth.verifyEmailOtp(type = io.github.jan.supabase.auth.OtpType.Email.MAGIC_LINK, tokenHash = hash)
                DevicePoll.SignedIn
            }
            "pending" -> DevicePoll.Pending
            else -> DevicePoll.Expired
        }
    }
    val displayName: String get() {
        val u = client.auth.currentUserOrNull()
        return u?.userMetadata?.get("display_name")?.jsonPrimitive?.content ?: u?.email?.substringBefore("@") ?: "Host"
    }

    // Catalog
    @Serializable private data class Row(
        val id: String, val title: String, @SerialName("artist_credit") val artistCredit: String,
        @SerialName("album_id") val albumId: String? = null, @SerialName("duration_ms") val durationMs: Int? = null,
        @SerialName("release_year") val releaseYear: Int? = null, val albums: Album? = null,
    ) { @Serializable data class Album(val title: String) }
    @Serializable private data class Art(@SerialName("entity_id") val entityId: String, @SerialName("source_url") val sourceUrl: String, @SerialName("storage_path") val storagePath: String? = null)

    private suspend fun withArtwork(rows: List<Row>): List<Track> {
        val ids = rows.mapNotNull { it.albumId }.distinct()
        val art = if (ids.isEmpty()) emptyMap() else client.from("artwork").select(Columns.raw("entity_id, source_url, storage_path")) {
            filter { eq("entity_type", "album"); eq("is_primary", true); isIn("entity_id", ids) }
        }.decodeList<Art>().associate { it.entityId to (it.storagePath ?: it.sourceUrl) }
        return rows.map { Track(it.id, it.title, it.artistCredit, it.albumId, it.albums?.title, it.durationMs, it.releaseYear, it.albumId?.let(art::get)) }
    }

    private val trackCols = Columns.raw("id, title, artist_credit, album_id, duration_ms, release_year, albums(title)")

    suspend fun track(id: String): Track? = withArtwork(
        client.from("tracks").select(trackCols) { filter { eq("id", id) } }.decodeList<Row>()).firstOrNull()

    suspend fun popular(limit: Int = 30): List<Track> = withArtwork(
        client.from("tracks").select(trackCols) { order("popularity", Order.DESCENDING); range(0L, limit - 1L) }.decodeList<Row>())

    /** Songs with SoundCheck Stage assets this user can open (newest first). */
    suspend fun karaokeReady(limit: Int = 30): List<Track> {
        @Serializable data class A(@SerialName("track_id") val trackId: String)
        val ids = client.from("karaoke_analysis").select(Columns.raw("track_id")) { order("created_at", Order.DESCENDING); limit(limit.toLong()) }
            .decodeList<A>().map { it.trackId }.distinct()
        if (ids.isEmpty()) return emptyList()
        val byId = withArtwork(client.from("tracks").select(trackCols) { filter { isIn("id", ids) } }.decodeList<Row>()).associateBy { it.id }
        return ids.mapNotNull(byId::get)
    }

    private suspend fun invoke(fn: String, body: JsonObject): JsonObject =
        json.parseToJsonElement(client.functions.invoke(fn, body = body).bodyAsText()).jsonObject

    /** Tiered search (Supabase → Turso → MusicBrainz live) through catalog-search. */
    suspend fun search(q: String, limit: Int = 30): List<Track> {
        val r = invoke("catalog-search", buildJsonObject { put("q", q); put("limit", limit) })
        return json.decodeFromJsonElement(r["results"]!!)
    }

    /** Missing album artwork on demand (resolve-artwork: Cover Art Archive → iTunes). */
    suspend fun resolveArtwork(albumId: String): String? = runCatching {
        invoke("resolve-artwork", buildJsonObject { put("album_id", albumId) })["url"]?.jsonPrimitive?.content?.takeIf { it != "null" }
    }.getOrNull()

    suspend fun isKaraokeReady(trackId: String): Boolean = runCatching {
        client.from("karaoke_analysis").select(Columns.raw("id")) { filter { eq("track_id", trackId) }; limit(1) }.decodeList<JsonObject>().isNotEmpty()
    }.getOrDefault(false)

    /** Best way to listen on this device: a full-length open recording when one exists, else a labelled 30 s preview. */
    data class ListenSource(val url: String, val full: Boolean, val label: String, val credit: String?)
    suspend fun listenSource(trackId: String): ListenSource? {
        @Serializable data class S(@SerialName("stream_url") val streamUrl: String? = null, val url: String? = null, @SerialName("license_url") val licenseUrl: String? = null)
        val open = runCatching {
            client.from("track_sources").select(Columns.raw("stream_url, url, license_url")) {
                filter { eq("track_id", trackId); eq("provider", "internet_archive") }; limit(1)
            }.decodeList<S>().firstOrNull()
        }.getOrNull()
        if (open?.streamUrl != null) return ListenSource(open.streamUrl, true, listOfNotNull("Internet Archive", licenseLabel(open.licenseUrl)).joinToString(" · "), open.url)
        val pv = preview(trackId) ?: return null
        return ListenSource(pv.first, false, "Preview · 30 s", pv.second)
    }

    /** 30 s preview (resolve-preview) + the store page to credit. */
    suspend fun preview(trackId: String): Pair<String, String?>? = runCatching {
        val r = invoke("resolve-preview", buildJsonObject { put("track_id", trackId) })
        val url = r["url"]?.jsonPrimitive?.content?.takeIf { it != "null" } ?: return null
        url to r["attribution_url"]?.jsonPrimitive?.content?.takeIf { it != "null" }
    }.getOrNull()

    suspend fun lyrics(trackId: String): List<LyricLine> = runCatching {
        val r = invoke("fetch-lyrics", buildJsonObject { put("track_id", trackId) })
        json.decodeFromJsonElement<List<LyricLine>>(r["lines"] ?: return emptyList())
            .filter { it.start != null && it.text.isNotBlank() }
    }.getOrDefault(emptyList())

    /** Everything SoundCheck Stage needs for a track (mirror of useStageData.ts / SoundCheckKit). */
    suspend fun stageData(trackId: String): StageLoad = coroutineScope {
        @Serializable data class T(val id: String, val title: String, @SerialName("artist_credit") val artistCredit: String, @SerialName("album_id") val albumId: String? = null)
        @Serializable data class WordLyrics(val lines: List<LyricLine>)
        @Serializable data class An(
            val id: String, @SerialName("source_asset_id") val sourceAssetId: String, val notes: List<RefNote>,
            @SerialName("musical_key") val musicalKey: String? = null, @SerialName("vocal_range") val vocalRange: VocalRange? = null,
            @SerialName("word_lyrics") val wordLyrics: WordLyrics? = null,
        )
        @Serializable data class Stem(val kind: String, @SerialName("storage_path") val storagePath: String? = null)

        val t = client.from("tracks").select(Columns.raw("id, title, artist_credit, album_id")) { filter { eq("id", trackId) } }.decodeList<T>().firstOrNull()
            ?: error("song not found")
        if (!isSignedIn) return@coroutineScope StageLoad.SignedOut
        val a = client.from("karaoke_analysis").select(Columns.raw("id, source_asset_id, notes, musical_key, vocal_range, word_lyrics")) {
            filter { eq("track_id", trackId) }; order("created_at", Order.DESCENDING); limit(1)
        }.decodeList<An>().firstOrNull() ?: return@coroutineScope StageLoad.NotReady(t.title)
        val lyricsQ = async { runCatching { invoke("fetch-lyrics", buildJsonObject { put("track_id", trackId) }) }.getOrNull() }
        val stems = client.from("audio_assets").select(Columns.raw("kind, storage_path")) {
            filter { eq("source_asset_id", a.sourceAssetId); isIn("kind", listOf("instrumental", "vocals")) }
        }.decodeList<Stem>()
        val ip = stems.firstOrNull { it.kind == "instrumental" }?.storagePath
        val vp = stems.firstOrNull { it.kind == "vocals" }?.storagePath
        if (ip == null || vp == null) return@coroutineScope StageLoad.NotReady(t.title)
        val bucket = client.storage.from("audio")
        val iu = async { bucket.createSignedUrl(ip, 3.hours) }
        val vu = async { bucket.createSignedUrl(vp, 3.hours) }
        val track = withArtwork(listOf(Row(t.id, t.title, t.artistCredit, t.albumId))).first()
        val lyr = lyricsQ.await()
        val shared = lyr?.get("lines")?.let { json.decodeFromJsonElement<List<LyricLine>>(it) }
        val lines = (a.wordLyrics?.lines ?: shared ?: emptyList()).filter { it.start != null && it.text.isNotBlank() }
        StageLoad.Ready(StageData(track, a.notes, a.musicalKey, a.vocalRange, lines,
            a.wordLyrics != null || lyr?.get("granularity")?.jsonPrimitive?.content == "word", absolute(iu.await()), absolute(vu.await())))
    }

    private fun absolute(u: String) = if (u.startsWith("http")) u else config.supabaseUrl.trimEnd('/') + "/storage/v1/" + u.trimStart('/')

    /** Official SoundCheck Score (score-performance); one result per singer. */
    suspend fun score(trackId: String, sessionId: String?, keyShift: Int, singers: List<ScoreSinger>): List<ScoredSinger> {
        val body = buildJsonObject {
            put("track_id", trackId); sessionId?.let { put("session_id", it) }; put("key_shift", keyShift)
            putJsonArray("singers") {
                singers.forEach { s ->
                    addJsonObject {
                        s.memberId?.let { put("member_id", it) }
                        putJsonArray("frames") { s.frames.forEach { add(it) } }
                        put("latency_ms", s.latencyMs); put("noise_floor_db", s.noiseFloorDb)
                    }
                }
            }
        }
        return json.decodeFromJsonElement(invoke("score-performance", body)["results"]!!)
    }

    // Sessions
    suspend fun createSession(platform: Platform, trackId: String?): SessionInfo {
        @Serializable data class R(@SerialName("session_id") val sessionId: String, @SerialName("pairing_code") val code: String)
        val r = client.postgrest.rpc("create_session", buildJsonObject { put("p_platform", platform.name); put("p_display_name", displayName) }).decodeList<R>().first()
        client.from("karaoke_sessions").update(buildJsonObject { put("status", "active"); put("current_track_id", trackId) }) { filter { eq("id", r.sessionId) } }
        return SessionInfo(r.sessionId, r.code)
    }

    suspend fun joinSession(code: String, displayName: String, platform: Platform): JoinInfo {
        @Serializable data class R(@SerialName("session_id") val sessionId: String, @SerialName("member_id") val memberId: String, val color: String)
        val r = client.postgrest.rpc("join_session", buildJsonObject { put("p_code", code); put("p_display_name", displayName); put("p_platform", platform.name) })
            .decodeList<R>().first()
        return JoinInfo(r.sessionId, r.memberId, r.color)
    }

    /** Re-open a session this user hosts (next song in the same party); null if it's gone or not theirs. */
    suspend fun resumeSession(id: String, trackId: String?): SessionInfo? = runCatching {
        @Serializable data class S(val id: String, @SerialName("pairing_code") val code: String, @SerialName("host_id") val hostId: String, val status: String)
        val s = client.from("karaoke_sessions").select(Columns.raw("id, pairing_code, host_id, status")) { filter { eq("id", id) } }.decodeList<S>().firstOrNull()
        if (s == null || s.hostId != userId || s.status == "ended") return null
        client.from("karaoke_sessions").update(buildJsonObject { put("current_track_id", trackId) }) { filter { eq("id", id) } }
        SessionInfo(s.id, s.code)
    }.getOrNull()

    /** The party's song queue (queued + playing), oldest request first. */
    suspend fun sessionQueue(sessionId: String): List<QueueItem> = runCatching {
        client.postgrest.rpc("session_queue_list", buildJsonObject { put("p_session_id", sessionId) }).decodeList<QueueItem>()
    }.getOrDefault(emptyList())

    /** Host: finish the current song and start the next request; returns its track id (null when empty). */
    suspend fun advanceQueue(sessionId: String, skip: Boolean = false): String? {
        @Serializable data class R(@SerialName("track_id") val trackId: String)
        return client.postgrest.rpc("advance_queue", buildJsonObject { put("p_session_id", sessionId); put("p_skip", skip) }).decodeList<R>().firstOrNull()?.trackId
    }

    fun joinUrl(code: String) = "${config.siteUrl.trimEnd('/')}/join/$code"
}

/** "CC BY-NC-SA 3.0" from a Creative Commons deed URL (mirror of contracts/providers.ts). */
fun licenseLabel(url: String?): String? {
    if (url == null) return null
    Regex("licenses/([a-z-]+)/([\\d.]+)", RegexOption.IGNORE_CASE).find(url)?.let { return "CC ${it.groupValues[1].uppercase()} ${it.groupValues[2]}" }
    if (url.contains("publicdomain/zero", true)) return "CC0"
    if (url.contains("publicdomain", true)) return "Public domain"
    return "Open license"
}
