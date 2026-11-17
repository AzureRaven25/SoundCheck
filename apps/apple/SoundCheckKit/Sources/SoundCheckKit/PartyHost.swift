import Foundation
import Observation

public struct PartySinger: Identifiable, Equatable, Sendable {
    public let memberId: String
    public let name: String
    public let color: String
    public var mic: MicState
    public var latencyMs: Double?
    public var noiseFloorDb: Double?
    public var id: String { memberId }
}

/// Host side of SoundCheck Party (the TV): creates the session, publishes the transport clock (anchored
/// to real playback position), collects each phone's pitch frames, answers clock pings, and broadcasts
/// live scores and results. Mirror of apps/web/src/session/useHostSession.ts.
@MainActor @Observable
public final class PartyHost {
    public private(set) var session: SessionInfo?
    public private(set) var members: [PresenceState] = []
    public private(set) var error: String?
    private var status: [String: MicStatusEvent] = [:]
    @ObservationIgnored private var channel: SessionChannel?
    @ObservationIgnored private var frames: [String: [Double]] = [:]
    @ObservationIgnored private var lastSeq: [String: Int] = [:]
    @ObservationIgnored private var transport: TransportEvent?
    @ObservationIgnored private var heartbeat: Task<Void, Never>?
    @ObservationIgnored public var position: () -> Double = { 0 }
    @ObservationIgnored private let backend: SoundCheckBackend
    @ObservationIgnored private let platform: Platform

    public init(backend: SoundCheckBackend, platform: Platform = .tvos) { self.backend = backend; self.platform = platform }

    public var singers: [PartySinger] {
        members.filter { $0.role == "singer" }.map { m in
            PartySinger(memberId: m.memberId, name: m.displayName, color: m.color, mic: status[m.memberId]?.state ?? m.mic,
                        latencyMs: status[m.memberId]?.latencyMs, noiseFloorDb: status[m.memberId]?.noiseFloorDb)
        }
    }
    public var readySingers: [PartySinger] { singers.filter { $0.mic == .ready || $0.mic == .live } }

    public func open(trackId: String?) async {
        error = nil
        do {
            let s = try await backend.createSession(platform: platform, trackId: trackId)
            let uid = backend.currentUser?.id.uuidString.lowercased() ?? UUID().uuidString
            channel = try await SessionChannel.open(backend: backend, sessionId: s.id, presenceKey: "host-\(uid)",
                onEvent: { [weak self] in self?.handle($0) },
                onPresence: { [weak self] in self?.members = $0.filter { $0.role != "host" } })
            await channel?.track(PresenceState(memberId: "host", displayName: backend.displayName, role: "host", platform: platform, color: "#FFFFFF", mic: .off))
            session = s
            startHeartbeat()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func handle(_ e: SessionEvent) {
        switch e {
        case .pitch(let p):
            if p.seq <= (lastSeq[p.memberId] ?? -1) || p.frames.count % SCProtocol.frameStride != 0 { return }
            lastSeq[p.memberId] = p.seq
            frames[p.memberId, default: []].append(contentsOf: p.frames)
        case .clockPing(let p):
            let t1 = Clock.nowMs
            Task { await channel?.send(.clockPong(ClockPongEvent(memberId: p.memberId, id: p.id, t0: p.t0, t1: t1, t2: Clock.nowMs))) }
        case .micStatus(let s):
            status[s.memberId] = s
        default: break
        }
    }

    /// Every 2 s while playing, re-anchor the transport to the real playback position so phones follow
    /// the audio clock rather than this device's wall clock.
    private func startHeartbeat() {
        heartbeat?.cancel()
        heartbeat = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                guard let self, var t = self.transport, t.state == .playing else { continue }
                t.songPos = self.position()
                t.hostClock = Clock.nowMs
                self.transport = t
                await self.channel?.send(.transport(t))
            }
        }
    }

    public func publishTransport(_ state: TransportState, songPos: Double, keyShift: Int, trackId: String) {
        let ev = TransportEvent(state: state, trackId: trackId, songPos: songPos, hostClock: Clock.nowMs, keyShift: keyShift,
                                singerMemberIds: readySingers.map(\.memberId))
        transport = ev
        Task { await channel?.send(.transport(ev)) }
    }

    public func resetTake() { frames = [:]; lastSeq = [:] }
    public func framesOf(_ memberId: String) -> [Double] { frames[memberId] ?? [] }
    public func send(_ e: SessionEvent) { Task { await channel?.send(e) } }

    /// Live hit rate per singer over the take so far (needs > 20 voiced frames on reference notes).
    public func liveRates(notes: [RefNote], keyShift: Int) -> [String: Double] {
        var out: [String: Double] = [:]
        for s in singers {
            let f = framesOf(s.memberId)
            var hit = 0, total = 0
            var i = 0
            while i + 3 < f.count {
                let frame = PitchFrame(f0: f[i + 1], conf: f[i + 2], rmsDb: f[i + 3])
                if PitchDetector.isVoiced(frame, noiseFloorDb: s.noiseFloorDb), let ref = Timing.noteAt(notes, f[i]) {
                    total += 1
                    if Pitch.liveHit(f0: frame.f0, refMidi: ref, keyShift: keyShift) == true { hit += 1 }
                }
                i += SCProtocol.frameStride
            }
            if total > 20 { out[s.memberId] = Double(hit) / Double(total) }
        }
        return out
    }

    /// Last ~3 s of a singer's trail as (song time, MIDI or nil when unvoiced).
    public func trail(_ s: PartySinger) -> [(Double, Double?)] {
        let f = framesOf(s.memberId)
        var pts: [(Double, Double?)] = []
        var i = max(0, f.count - SCProtocol.frameStride * 300)
        while i + 3 < f.count {
            let frame = PitchFrame(f0: f[i + 1], conf: f[i + 2], rmsDb: f[i + 3])
            pts.append((f[i], PitchDetector.isVoiced(frame, noiseFloorDb: s.noiseFloorDb) ? Pitch.midi(frame.f0) : nil))
            i += SCProtocol.frameStride
        }
        return pts
    }

    public func close() async {
        heartbeat?.cancel()
        await channel?.close()
        channel = nil
        session = nil
    }
}
