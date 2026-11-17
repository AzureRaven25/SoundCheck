package app.soundcheck.tv

import android.content.Context
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.math.pow

/**
 * SoundCheck Stage playback on Android (docs/ARCHITECTURE.md): instrumental + guide-vocal stems on two Media3
 * players started together; key shift via PlaybackParameters pitch (Sonic) without changing tempo.
 */
class StageEngine(ctx: Context) {
    private val inst = ExoPlayer.Builder(ctx).build()
    private val vocal = ExoPlayer.Builder(ctx).build().apply { volume = 0f }
    var onEnded: (() -> Unit)? = null
    val duration get() = inst.duration.takeIf { it > 0 }?.div(1000.0) ?: 0.0
    val isPlaying get() = inst.playWhenReady && inst.playbackState == Player.STATE_READY
    var loaded = false; private set

    init {
        inst.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_ENDED) onEnded?.invoke() }
        })
    }

    suspend fun load(instrumental: String, vocals: String) {
        inst.setMediaItem(MediaItem.fromUri(instrumental)); vocal.setMediaItem(MediaItem.fromUri(vocals))
        inst.prepare(); vocal.prepare()
        awaitReady(inst); awaitReady(vocal)
        loaded = true
    }

    private suspend fun awaitReady(p: ExoPlayer) {
        if (p.playbackState == Player.STATE_READY) return
        suspendCancellableCoroutine { c ->
            val l = object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) { if (state == Player.STATE_READY) { p.removeListener(this); if (c.isActive) c.resume(Unit) } }
                override fun onPlayerError(error: androidx.media3.common.PlaybackException) { p.removeListener(this); if (c.isActive) c.cancel(error) }
            }
            p.addListener(l)
            c.invokeOnCancellation { p.removeListener(l) }
        }
    }

    private val clock = app.soundcheck.core.SmoothedClock()

    /** Song position (s): the instrumental player's clock, smoothed (raw currentPosition can jitter ±100 ms+). */
    fun position(): Double {
        val raw = inst.currentPosition / 1000.0
        if (!isPlaying) { clock.reset(); return raw }
        return clock.sample(System.currentTimeMillis().toDouble(), raw)
    }

    fun play(from: Double? = null) {
        if (from != null) { val ms = (from * 1000).toLong(); inst.seekTo(ms); vocal.seekTo(ms) }
        inst.play(); vocal.play()
    }
    fun pause() { inst.pause(); vocal.pause(); vocal.seekTo(inst.currentPosition) }
    fun setKey(semitones: Int) {
        val p = PlaybackParameters(1f, 2.0.pow(semitones / 12.0).toFloat())
        inst.playbackParameters = p; vocal.playbackParameters = p
    }
    fun setGuide(v: Float) { vocal.volume = v }
    fun release() { inst.release(); vocal.release() }
}
