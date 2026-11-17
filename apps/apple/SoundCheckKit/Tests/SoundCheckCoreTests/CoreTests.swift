import Foundation
import Testing
@testable import SoundCheckCore

/// Golden fixtures shared with packages/contracts (TypeScript) and the Kotlin :core module.
let fixtureURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("../../../packages/contracts/fixtures/realtime/clock_sync.json").standardized

struct ClockFixture: Decodable {
    struct Expected: Decodable { let offsetMs: Double; let rttMs: Double }
    let pong: ClockPongEvent; let t3: Double; let expected: Expected
    let transport: TransportEvent; let phoneNowMs: Double; let expectedSongPos: Double
}

@Suite struct ProtocolTests {
    let fx = try! JSONDecoder().decode(ClockFixture.self, from: Data(contentsOf: fixtureURL))

    @Test func clockOffsetGolden() {
        let r = Clock.offset(fx.pong, t3: fx.t3)
        #expect(abs(r.offsetMs - fx.expected.offsetMs) < 1e-6)
        #expect(abs(r.rttMs - fx.expected.rttMs) < 1e-6)
    }

    @Test func songPositionGolden() {
        let off = Clock.offset(fx.pong, t3: fx.t3).offsetMs
        #expect(abs(Clock.songPosition(fx.transport, phoneNowMs: fx.phoneNowMs, offsetMs: off) - fx.expectedSongPos) < 1e-6)
        var paused = fx.transport; paused.state = .paused
        #expect(Clock.songPosition(paused, phoneNowMs: fx.phoneNowMs + 99_999, offsetMs: 0) == 12.5)
    }

    @Test func decodesWebMessagesAndRejectsOthers() throws {
        let web = #"{"type":"pitch","v":1,"memberId":"m","seq":3,"frames":[1.5,220,0.9,-20]}"#
        #expect(SessionEvent.decode(Data(web.utf8)) == .pitch(PitchEvent(memberId: "m", seq: 3, frames: [1.5, 220, 0.9, -20])))
        #expect(SessionEvent.decode(Data(#"{"type":"transport","v":2}"#.utf8)) == nil)
        #expect(SessionEvent.decode(Data(#"{"type":"nope","v":1}"#.utf8)) == nil)
        let ev = SessionEvent.results(ResultsEvent(trackId: "t", performances: [PerformanceResult(memberId: "m", performanceId: nil, score: 84, grade: .B, pitch: 1, timing: 0.8, rhythm: 0.7, stability: 0.9, feedback: ["x"])]))
        #expect(SessionEvent.decode(try ev.encoded()) == ev)
        let json = String(data: try ev.encoded(), encoding: .utf8)!
        #expect(json.contains(#""type":"results""#))
        #expect(SCProtocol.channelName("abc") == "session:abc")
    }

    @Test func bestOffsetUsesLowestRtt() {
        #expect(Clock.bestOffset([(100, 500), (10, 20), (12, 22), (14, 24), (-300, 900)]) == 12)
    }
}

@Suite struct TimingTests {
    let lines = [LyricLine(start: 2, text: "Hello from the stage"), LyricLine(start: 8, text: "Every singer")]
    @Test func lineLookup() {
        #expect(Timing.lineAt(lines, 1) == -1)
        #expect(Timing.lineAt(lines, 2) == 0)
        #expect(Timing.lineAt(lines, 9) == 1)
    }
    @Test func spreadsWordsOverSungNotes() {
        let notes = [RefNote(start: 2, end: 3, pitch: 60), RefNote(start: 3, end: 6, pitch: 62)]
        let w = Timing.words(of: lines[0], next: lines[1], notes: notes)
        #expect(w.map(\.text) == ["Hello", "from", "the", "stage"])
        #expect(w.first!.start == 2)
        #expect(abs(w.last!.end - 6) < 1e-9)
        #expect(Timing.progress(w[0], at: 1) == 0 && Timing.progress(w[0], at: 100) == 1)
        #expect(Timing.noteAt(notes, 4) == 62 && Timing.noteAt(notes, 7) == nil)
    }
    @Test func pitchRules() {
        #expect(Pitch.liveHit(f0: 440, refMidi: 69) == true)
        #expect(Pitch.liveHit(f0: 220, refMidi: 69) == true)        // octave-folded
        #expect(Pitch.liveHit(f0: 494, refMidi: 69) == false)       // two semitones off
        #expect(Pitch.liveHit(f0: 466.16, refMidi: 69, keyShift: 1) == true)
        #expect(Pitch.liveHit(f0: 0, refMidi: 69) == nil)
        #expect(Pitch.grade(95) == .S && Pitch.grade(84) == .B && Pitch.grade(10) == .D)
        #expect(Pitch.transposeKey("A minor", by: 1) == "B♭ minor")
        #expect(Pitch.transposeKey("C major", by: -1) == "B major")
    }
}

@Suite struct PitchDetectorTests {
    func sine(_ hz: Double, sr: Double, seconds: Double, amp: Float = 0.3) -> [Float] {
        (0..<Int(sr * seconds)).map { amp * Float(sin(2 * .pi * hz * Double($0) / sr)) }
    }
    @Test(arguments: [110.0, 220.0, 440.0, 660.0])
    func detectsSinePitch(hz: Double) {
        let d = PitchDetector(sampleRate: 48_000)
        var frames: [PitchFrame] = []
        d.process(sine(hz, sr: 48_000, seconds: 0.5)) { frames.append($0) }
        #expect(frames.count >= 40)                         // ~10 ms hop once the window fills
        let tail = frames.suffix(10)
        for f in tail {
            #expect(abs(1200 * log2(f.f0 / hz)) < 15)       // within 15 cents
            #expect(f.conf > 0.8)
        }
    }
    @Test func silenceIsUnvoiced() {
        let d = PitchDetector(sampleRate: 44_100)
        var frames: [PitchFrame] = []
        d.process([Float](repeating: 0, count: 44_100 / 2)) { frames.append($0) }
        #expect(frames.allSatisfy { $0.f0 == 0 })
        #expect(PitchDetector.noiseFloor([-60, -50, -40, -30, -20]) == -20)
    }
}
