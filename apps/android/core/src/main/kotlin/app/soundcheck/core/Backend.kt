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

@Serializable
data class ScoredSinger(
    @SerialName("member_id") val memberId: String? = null,
    @SerialName("performance_id") val performanceId: String? = null,
    val score: Int, val grade: Grade, val pitch: Double, val timing: Double, val rhythm: Double, val stability: Double,
    val feedback: List<String>,
) {
    fun asResult() = PerformanceResult(memberId ?: "", performanceId, score, grade, pitch, timing, rhythm, stability, feedback)
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
    suspend fun awaitSession() { client.auth.awaitInitialization() }
    suspend fun signIn(email: String, password: String) { client.auth.signInWith(Email) { this.email = email; this.password = password } }
    suspend fun signUp(email: String, password: String, displayName: String) {
        client.auth.signUpWith(Email) { this.email = email; this.password = password; data = buildJsonObject { put("display_name", displayName) } }
    }
    /** Phones that join a party without an account become anonymous users (real auth.uid() for RLS). */
    suspend fun ensureSignedIn(displayName: String) {
        if (!isSignedIn) client.auth.signInAnonymously(data = buildJsonObject { put("display_name", displayName) })
    }
    suspend fun signOut() = client.auth.signOut()
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

    fun joinUrl(code: String) = "${config.siteUrl.trimEnd('/')}/join/$code"
}
