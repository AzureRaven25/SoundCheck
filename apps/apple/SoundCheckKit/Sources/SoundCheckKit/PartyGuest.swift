import Foundation
import Observation

/// Phone side of SoundCheck Party (SoundCheck Mobile): joins with the code, syncs its clock to the
/// host, and streams 10-frame pitch batches in song time. Mirror of apps/web/src/app/join/[code]/page.tsx.
@MainActor @Observable
public final class PartyGuest {
    public private(set) var joined: JoinInfo?
    public private(set) var transportState: TransportState = .idle
    public private(set) var hitRate: Double?
    public private(set) var result: PerformanceResult?
    public private(set) var muted = false
    public private(set) var line = ""
    public private(set) var error: String?
    @ObservationIgnored private var channel: SessionChannel?
    @ObservationIgnored private var transport: TransportEvent?
    @ObservationIgnored private var pongs: [(offsetMs: Double, rttMs: Double)] = []
    @ObservationIgnored private var offsetMs = 0.0
    @ObservationIgnored private var batch: [Double] = []
    @ObservationIgnored private var seq = 0
    @ObservationIgnored private var lines: [LyricLine] = []
    @ObservationIgnored private var lyricsFor: String?
    @ObservationIgnored private var name = "Singer"
    @ObservationIgnored private let backend: SoundCheckBackend
    @ObservationIgnored private let platform: Platform

    public init(backend: SoundCheckBackend, platform: Platform = .ios) { self.backend = backend; self.platform = platform }

    /// Song time the singer is hearing now (from the host's transport + clock offset).
    public func songTime(atMs now: Double = Clock.nowMs) -> Double {
        guard let t = transport else { return 0 }
        return Clock.songPosition(t, phoneNowMs: now, offsetMs: offsetMs)
    }
    public var isPlaying: Bool { transport?.state == .playing }

    public func join(code: String, displayName: String) async {
        error = nil
        name = displayName.trimmingCharacters(in: .whitespaces).isEmpty ? "Singer" : displayName
        do {
            try await backend.ensureSignedIn(displayName: name)
            let j = try await backend.joinSession(code: code.uppercased(), displayName: name, platform: platform)
            channel = try await SessionChannel.open(backend: backend, sessionId: j.sessionId, presenceKey: j.memberId,
                                                     onEvent: { [weak self] in self?.handle($0) })
            await channel?.track(PresenceState(memberId: j.memberId, displayName: name, role: "singer", platform: platform, color: j.color, mic: .off))
            joined = j
            for i in 0..<6 {   // clock sync; pongs refine the offset
                try? await Task.sleep(for: .milliseconds(i == 0 ? 0 : 250))
                await channel?.send(.clockPing(ClockPingEvent(memberId: j.memberId, id: i, t0: Clock.nowMs)))
            }
        } catch {
            let msg = String(describing: error)
            self.error = msg.contains("invalid") ? "That code isn’t active. Check the TV." : error.localizedDescription
        }
    }

    private func handle(_ e: SessionEvent) {
        let me = joined?.memberId
        switch e {
        case .transport(let t):
            transport = t
            transportState = t.state
            if let id = t.trackId, id != lyricsFor {
                lyricsFor = id
                Task { lines = await backend.lyrics(trackId: id) }
            }
        case .clockPong(let p) where p.memberId == me:
            pongs.append(Clock.offset(p, t3: Clock.nowMs))
            offsetMs = Clock.bestOffset(pongs)
        case .liveScore(let s):
            if let mine = s.scores.first(where: { $0.memberId == me }) { hitRate = mine.hitRate }
        case .results(let r):
            if let mine = r.performances.first(where: { $0.memberId == me }) { result = mine }
        case .hostCommand(let c) where c.memberId == me:
            if c.command == .mute { muted = true }
            if c.command == .unmute { muted = false }
        default: break
        }
    }

    /// Report the calibrated mic (noise floor + input latency) to the host and presence.
    public func micReady(noiseFloorDb: Double, latencyMs: Double) async {
        guard let j = joined else { return }
        await channel?.send(.micStatus(MicStatusEvent(memberId: j.memberId, state: .ready, noiseFloorDb: noiseFloorDb, latencyMs: latencyMs)))
        await channel?.track(PresenceState(memberId: j.memberId, displayName: name, role: "singer", platform: platform, color: j.color, mic: .ready))
    }

    /// One pitch frame from the mic; batched 10 at a time onto the channel while the song plays.
    public func push(_ f: PitchFrame, capturedAtMs: Double) {
        guard let j = joined, let t = transport, t.state == .playing, !muted else { return }
        let st = Clock.songPosition(t, phoneNowMs: capturedAtMs, offsetMs: offsetMs)
        batch.append(contentsOf: [(st * 1000).rounded() / 1000, (f.f0 * 100).rounded() / 100, (f.conf * 1000).rounded() / 1000, (f.rmsDb * 10).rounded() / 10])
        if batch.count >= SCProtocol.framesPerMessage * SCProtocol.frameStride {
            let ev = PitchEvent(memberId: j.memberId, seq: seq, frames: batch)
            seq += 1
            batch = []
            Task { await channel?.send(.pitch(ev)) }
        }
    }

    /// Current lyric line (call on a timer while live).
    public func refreshLine() {
        let i = Timing.lineAt(lines, songTime())
        line = i >= 0 ? lines[i].text : ""
    }

    public func leave() async { await channel?.close(); channel = nil; joined = nil }
}
