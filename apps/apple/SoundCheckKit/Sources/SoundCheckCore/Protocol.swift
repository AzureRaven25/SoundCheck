import Foundation

/// SoundCheck Stage realtime protocol v1: a mirror of packages/contracts/src/realtime.ts.
/// Broadcast event "sc" on the private channel `session:<id>`. All `songPos`/`t` are song seconds;
/// wall-clock values are epoch milliseconds.
public enum SCProtocol {
    public static let version = 1
    public static let frameStride = 4
    public static let framesPerMessage = 10
    public static let frameHop = 0.01
    public static let broadcastEvent = "sc"
    public static func channelName(_ sessionId: String) -> String { "session:\(sessionId)" }
}

public enum Platform: String, Codable, Sendable { case web, tvos, firetv, ios, android }
public enum MicState: String, Codable, Sendable { case off, calibrating, ready, live, muted, error }
public enum TransportState: String, Codable, Sendable { case idle, countdown, playing, paused, ended }
public enum Grade: String, Codable, Sendable { case S, A, B, C, D }

public struct TransportEvent: Codable, Equatable, Sendable {
    public var type = "transport"
    public var v = SCProtocol.version
    public var state: TransportState
    public var trackId: String?
    public var queueItemId: String?
    public var songPos: Double
    public var hostClock: Double
    public var keyShift: Int
    public var singerMemberIds: [String]
    public init(state: TransportState, trackId: String?, queueItemId: String? = nil, songPos: Double, hostClock: Double, keyShift: Int, singerMemberIds: [String]) {
        self.state = state; self.trackId = trackId; self.queueItemId = queueItemId; self.songPos = songPos
        self.hostClock = hostClock; self.keyShift = keyShift; self.singerMemberIds = singerMemberIds
    }
}

public struct PitchEvent: Codable, Equatable, Sendable {
    public var type = "pitch"
    public var v = SCProtocol.version
    public var memberId: String
    public var seq: Int
    /// Flat frames, 4 numbers each: [t, f0Hz (0 = unvoiced), confidence 0–1, rmsDb].
    public var frames: [Double]
    public init(memberId: String, seq: Int, frames: [Double]) { self.memberId = memberId; self.seq = seq; self.frames = frames }
}

public struct ClockPingEvent: Codable, Equatable, Sendable {
    public var type = "clock_ping"
    public var v = SCProtocol.version
    public var memberId: String
    public var id: Int
    public var t0: Double
    public init(memberId: String, id: Int, t0: Double) { self.memberId = memberId; self.id = id; self.t0 = t0 }
}

public struct ClockPongEvent: Codable, Equatable, Sendable {
    public var type = "clock_pong"
    public var v = SCProtocol.version
    public var memberId: String
    public var id: Int
    public var t0: Double
    public var t1: Double
    public var t2: Double
    public init(memberId: String, id: Int, t0: Double, t1: Double, t2: Double) {
        self.memberId = memberId; self.id = id; self.t0 = t0; self.t1 = t1; self.t2 = t2
    }
}

public struct MicStatusEvent: Codable, Equatable, Sendable {
    public var type = "mic_status"
    public var v = SCProtocol.version
    public var memberId: String
    public var state: MicState
    public var noiseFloorDb: Double?
    public var latencyMs: Double?
    public var error: String?
    public init(memberId: String, state: MicState, noiseFloorDb: Double?, latencyMs: Double?, error: String? = nil) {
        self.memberId = memberId; self.state = state; self.noiseFloorDb = noiseFloorDb; self.latencyMs = latencyMs; self.error = error
    }
}

public struct LiveScoreEvent: Codable, Equatable, Sendable {
    public struct Entry: Codable, Equatable, Sendable {
        public var memberId: String; public var hitRate: Double; public var combo: Int
        public init(memberId: String, hitRate: Double, combo: Int) { self.memberId = memberId; self.hitRate = hitRate; self.combo = combo }
    }
    public var type = "live_score"
    public var v = SCProtocol.version
    public var scores: [Entry]
    public init(scores: [Entry]) { self.scores = scores }
}

public struct PerformanceResult: Codable, Equatable, Sendable, Identifiable {
    public var memberId: String
    public var performanceId: String?
    public var score: Int
    public var grade: Grade
    public var pitch: Double
    public var timing: Double
    public var rhythm: Double
    public var stability: Double
    /** SoundCheck Score v1.1+ (absent from older results) */
    public var duration: Double?
    public var transitions: Double?
    public var feedback: [String]
    public var id: String { memberId }
    public init(memberId: String, performanceId: String?, score: Int, grade: Grade, pitch: Double, timing: Double, rhythm: Double, stability: Double,
                duration: Double? = nil, transitions: Double? = nil, feedback: [String]) {
        self.memberId = memberId; self.performanceId = performanceId; self.score = score; self.grade = grade
        self.pitch = pitch; self.timing = timing; self.rhythm = rhythm; self.stability = stability
        self.duration = duration; self.transitions = transitions; self.feedback = feedback
    }
}

public struct GroupScore: Codable, Equatable, Sendable { public var score: Int; public var grade: Grade; public var singers: Int
    public init(score: Int, grade: Grade, singers: Int) { self.score = score; self.grade = grade; self.singers = singers } }

public struct ResultsEvent: Codable, Equatable, Sendable {
    public var type = "results"
    public var v = SCProtocol.version
    public var trackId: String
    public var performances: [PerformanceResult]
    public var group: GroupScore?
    public init(trackId: String, performances: [PerformanceResult], group: GroupScore? = nil) { self.trackId = trackId; self.performances = performances; self.group = group }
}

public struct HostCommandEvent: Codable, Equatable, Sendable {
    public enum Command: String, Codable, Sendable { case mute, unmute, kick, set_volume }
    public var type = "host_command"
    public var v = SCProtocol.version
    public var memberId: String
    public var command: Command
    public var value: Double?
    public init(memberId: String, command: Command, value: Double? = nil) { self.memberId = memberId; self.command = command; self.value = value }
}

/// Any protocol message. Unknown types or other protocol versions decode to nil via `SessionEvent.decode`.
public enum SessionEvent: Equatable, Sendable {
    case transport(TransportEvent)
    case pitch(PitchEvent)
    case clockPing(ClockPingEvent)
    case clockPong(ClockPongEvent)
    case micStatus(MicStatusEvent)
    case liveScore(LiveScoreEvent)
    case results(ResultsEvent)
    case hostCommand(HostCommandEvent)
    /// The session's song queue changed; re-read it (session_queue_list). Carries no data.
    case queueChanged

    private struct Head: Decodable { let type: String; let v: Int }

    public static func decode(_ data: Data) -> SessionEvent? {
        let d = JSONDecoder()
        guard let head = try? d.decode(Head.self, from: data), head.v == SCProtocol.version else { return nil }
        switch head.type {
        case "transport": return (try? d.decode(TransportEvent.self, from: data)).map(SessionEvent.transport)
        case "pitch": return (try? d.decode(PitchEvent.self, from: data)).map(SessionEvent.pitch)
        case "clock_ping": return (try? d.decode(ClockPingEvent.self, from: data)).map(SessionEvent.clockPing)
        case "clock_pong": return (try? d.decode(ClockPongEvent.self, from: data)).map(SessionEvent.clockPong)
        case "mic_status": return (try? d.decode(MicStatusEvent.self, from: data)).map(SessionEvent.micStatus)
        case "live_score": return (try? d.decode(LiveScoreEvent.self, from: data)).map(SessionEvent.liveScore)
        case "results": return (try? d.decode(ResultsEvent.self, from: data)).map(SessionEvent.results)
        case "host_command": return (try? d.decode(HostCommandEvent.self, from: data)).map(SessionEvent.hostCommand)
        case "queue_changed": return .queueChanged
        default: return nil
        }
    }

    public func encoded() throws -> Data {
        let e = JSONEncoder()
        switch self {
        case .transport(let x): return try e.encode(x)
        case .pitch(let x): return try e.encode(x)
        case .clockPing(let x): return try e.encode(x)
        case .clockPong(let x): return try e.encode(x)
        case .micStatus(let x): return try e.encode(x)
        case .liveScore(let x): return try e.encode(x)
        case .results(let x): return try e.encode(x)
        case .hostCommand(let x): return try e.encode(x)
        case .queueChanged: return Data(#"{"type":"queue_changed","v":\#(SCProtocol.version)}"#.utf8)
        }
    }
}

/// Presence payload each device tracks on the channel.
public struct PresenceState: Codable, Equatable, Sendable, Identifiable {
    public var memberId: String
    public var displayName: String
    public var role: String   // host | singer | viewer
    public var platform: Platform
    public var color: String
    public var mic: MicState
    public var id: String { memberId }
    public init(memberId: String, displayName: String, role: String, platform: Platform, color: String, mic: MicState) {
        self.memberId = memberId; self.displayName = displayName; self.role = role; self.platform = platform; self.color = color; self.mic = mic
    }
}

public enum Clock {
    /// Clock offset (host − phone, ms) and round-trip time from a ping/pong exchange (NTP-style).
    public static func offset(_ p: ClockPongEvent, t3: Double) -> (offsetMs: Double, rttMs: Double) {
        let rtt = t3 - p.t0 - (p.t2 - p.t1)
        let off = ((p.t1 - p.t0) + (p.t2 - t3)) / 2
        return (off, rtt)
    }

    /// Current song position as seen by a phone, given the latest transport event and clock offset.
    public static func songPosition(_ ev: TransportEvent, phoneNowMs: Double, offsetMs: Double) -> Double {
        guard ev.state == .playing else { return ev.songPos }
        let hostNow = phoneNowMs + offsetMs
        return ev.songPos + max(0, hostNow - ev.hostClock) / 1000
    }

    /// Robust offset from many exchanges: the mean of the 3 lowest-RTT samples.
    public static func bestOffset(_ samples: [(offsetMs: Double, rttMs: Double)]) -> Double {
        let best = samples.sorted { $0.rttMs < $1.rttMs }.prefix(3)
        return best.isEmpty ? 0 : best.map(\.offsetMs).reduce(0, +) / Double(best.count)
    }

    public static var nowMs: Double { Date().timeIntervalSince1970 * 1000 }
}
