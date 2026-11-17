@preconcurrency import AVFoundation
import Foundation

/// SoundCheck Stage playback on Apple platforms (docs/ARCHITECTURE.md): instrumental + guide-vocal stems
/// on two AVAudioPlayerNodes started on one shared host time → submix → AVAudioUnitTimePitch (key
/// shift without changing tempo) → output. Stems are downloaded to temporary files only.
@MainActor
public final class StageEngine {
    public let engine = AVAudioEngine()
    private let inst = AVAudioPlayerNode()
    private let vocal = AVAudioPlayerNode()
    private let submix = AVAudioMixerNode()
    private let timePitch = AVAudioUnitTimePitch()
    private var instFile: AVAudioFile?
    private var vocalFile: AVAudioFile?
    private var startPos: Double = 0
    private var pausedAt: Double = 0
    private var generation = 0
    public private(set) var isPlaying = false
    public private(set) var duration: Double = 0
    public var onEnded: (() -> Void)?

    public init() {
        [inst, vocal, submix, timePitch].forEach { engine.attach($0) }
        engine.connect(inst, to: submix, format: nil)
        engine.connect(vocal, to: submix, format: nil)
        engine.connect(submix, to: timePitch, format: nil)
        engine.connect(timePitch, to: engine.mainMixerNode, format: nil)
        vocal.volume = 0
    }

    /// Download both stems (temporary files) and prepare playback.
    public func load(instrumental: URL, vocals: URL, progress: @escaping (Double) -> Void = { _ in }) async throws {
        progress(0)
        async let i = Self.download(instrumental)
        async let v = Self.download(vocals)
        let (iu, vu) = try await (i, v)
        progress(0.9)
        let fi = try AVAudioFile(forReading: iu), fv = try AVAudioFile(forReading: vu)
        instFile = fi; vocalFile = fv
        engine.disconnectNodeOutput(inst); engine.disconnectNodeOutput(vocal)
        engine.connect(inst, to: submix, format: fi.processingFormat)
        engine.connect(vocal, to: submix, format: fv.processingFormat)
        duration = Double(fi.length) / fi.processingFormat.sampleRate
        #if os(iOS) || os(tvOS)
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
        engine.prepare()
        try engine.start()
        progress(1)
    }

    private static func download(_ url: URL) async throws -> URL {
        if url.isFileURL { return url }
        let (tmp, resp) = try await URLSession.shared.download(from: url)
        guard (resp as? HTTPURLResponse)?.statusCode ?? 200 < 400 else { throw URLError(.badServerResponse) }
        let dest = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + "-" + url.lastPathComponent.components(separatedBy: "?")[0])
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }

    /// Current song position (s), from the instrumental player's render clock.
    public func position() -> Double {
        guard isPlaying, let nt = inst.lastRenderTime, let pt = inst.playerTime(forNodeTime: nt) else { return pausedAt }
        return min(duration, startPos + Double(pt.sampleTime) / pt.sampleRate)
    }

    public func play(from t: Double? = nil) {
        guard let fi = instFile, let fv = vocalFile else { return }
        let from = max(0, min(duration, t ?? pausedAt))
        inst.stop(); vocal.stop()
        generation += 1
        let gen = generation
        func schedule(_ node: AVAudioPlayerNode, _ f: AVAudioFile, ends: Bool) {
            let sr = f.processingFormat.sampleRate
            let startFrame = AVAudioFramePosition(from * sr)
            let count = AVAudioFrameCount(max(0, f.length - startFrame))
            guard count > 0 else { return }
            node.scheduleSegment(f, startingFrame: startFrame, frameCount: count, at: nil, completionCallbackType: .dataPlayedBack) { _ in
                guard ends else { return }
                Task { @MainActor [weak self] in
                    guard let self, self.generation == gen, self.isPlaying else { return }
                    self.isPlaying = false
                    self.pausedAt = self.duration
                    self.onEnded?()
                }
            }
        }
        schedule(inst, fi, ends: true)
        schedule(vocal, fv, ends: false)
        if !engine.isRunning { try? engine.start() }
        // start both stems on one host time so they stay sample-aligned
        let start = AVAudioTime(hostTime: mach_absolute_time() + AVAudioTime.hostTime(forSeconds: 0.05))
        inst.play(at: start); vocal.play(at: start)
        startPos = from
        isPlaying = true
    }

    public func pause() {
        guard isPlaying else { return }
        pausedAt = position()
        generation += 1
        isPlaying = false
        inst.stop(); vocal.stop()
    }

    public func setKey(_ semitones: Int) { timePitch.pitch = Float(semitones * 100) }
    public func setGuide(_ volume: Float) { vocal.volume = volume }

    public func stop() {
        pause()
        engine.stop()
    }
}
