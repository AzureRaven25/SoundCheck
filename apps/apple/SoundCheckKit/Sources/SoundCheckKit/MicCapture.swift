#if os(iOS)
@preconcurrency import AVFoundation
import Foundation

/// Microphone → pitch frames on iOS (SoundCheck Mobile). Voice-processing I/O gives echo cancellation
/// and noise suppression; the YIN detector is the same algorithm as the web worklet.
public final class MicCapture: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private var detector: PitchDetector?
    private let lock = NSLock()
    private var listeners: [(PitchFrame, Double) -> Void] = []
    /// Capture latency of this device (ms): frames describe audio heard this long ago.
    public private(set) var inputLatencyMs: Double = 0

    public init() {}

    public static func requestPermission() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    /// Start capturing; `onFrame(frame, capturedAtEpochMs)` runs on the audio thread.
    public func start(onFrame: @escaping (PitchFrame, Double) -> Void) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetoothA2DP])
        try session.setPreferredIOBufferDuration(0.005)
        try session.setActive(true)
        let input = engine.inputNode
        try? input.setVoiceProcessingEnabled(true)
        let format = input.outputFormat(forBus: 0)
        let det = PitchDetector(sampleRate: format.sampleRate)
        detector = det
        listeners = [onFrame]
        inputLatencyMs = (session.inputLatency + session.ioBufferDuration) * 1000
        input.installTap(onBus: 0, bufferSize: 512, format: format) { [weak self] buf, _ in
            guard let self, let ch = buf.floatChannelData?[0] else { return }
            let now = Date().timeIntervalSince1970 * 1000 - self.inputLatencyMs
            let samples = UnsafeBufferPointer(start: ch, count: Int(buf.frameLength))
            self.lock.lock(); let ls = self.listeners; self.lock.unlock()
            det.process(samples) { f in ls.forEach { $0(f, now) } }
        }
        engine.prepare()
        try engine.start()
    }

    /// Measure the room for `seconds` while the singer is silent; returns the noise floor (dBFS).
    public func calibrate(seconds: Double = 1.5) async -> Double {
        let levels = LevelBox()
        let l: (PitchFrame, Double) -> Void = { f, _ in levels.append(f.rmsDb) }
        lock.lock(); listeners.append(l); lock.unlock()
        try? await Task.sleep(for: .seconds(seconds))
        lock.lock(); listeners.removeLast(); lock.unlock()
        return PitchDetector.noiseFloor(levels.values)
    }

    public func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        lock.lock(); listeners = []; lock.unlock()
    }
}

private final class LevelBox: @unchecked Sendable {
    private let lock = NSLock()
    private var v: [Double] = []
    func append(_ x: Double) { lock.lock(); v.append(x); lock.unlock() }
    var values: [Double] { lock.lock(); defer { lock.unlock() }; return v }
}
#endif
