package app.soundcheck.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Track(
    val id: String,
    val title: String,
    @SerialName("artist_credit") val artistCredit: String,
    @SerialName("album_id") val albumId: String? = null,
    @SerialName("album_title") val albumTitle: String? = null,
    @SerialName("duration_ms") val durationMs: Int? = null,
    @SerialName("release_year") val releaseYear: Int? = null,
    @SerialName("artwork_url") val artworkUrl: String? = null,
) {
    val durationText: String get() = durationMs?.let { val s = it / 1000; "%d:%02d".format(s / 60, s % 60) } ?: ""
}

@Serializable data class LyricWord(val start: Double, val end: Double, val text: String)
@Serializable data class LyricLine(val start: Double? = null, val end: Double? = null, val text: String, val words: List<LyricWord>? = null)
@Serializable data class RefNote(val start: Double, val end: Double, val pitch: Double, val conf: Double? = null)
@Serializable data class VocalRange(val low: Double, val high: Double, val min: Double, val max: Double)

/** Everything SoundCheck Stage needs to run a song. */
data class StageData(
    val track: Track, val notes: List<RefNote>, val musicalKey: String?, val vocalRange: VocalRange?,
    val lines: List<LyricLine>, val wordTimed: Boolean, val instrumentalUrl: String, val vocalsUrl: String,
)
