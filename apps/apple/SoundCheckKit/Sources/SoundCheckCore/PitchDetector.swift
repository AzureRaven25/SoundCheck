import Foundation
#if canImport(Accelerate)
import Accelerate
#endif

public struct PitchFrame: Sendable, Equatable {
    public var f0: Double      // Hz, 0 = unvoiced
    public var conf: Double    // 0…1
    public var rmsDb: Double   // dBFS
    public init(f0: Double, conf: Double, rmsDb: Double) { self.f0 = f0; self.conf = conf; self.rmsDb = rmsDb }
}

/// YIN pitch detector: a straight port of apps/web/public/worklets/pitch-processor.js, so every
/// platform measures pitch identically. Feed mono samples at any rate; emits one frame per 10 ms
/// from a 1024-sample window at ~16 kHz (resolves 60–1000 Hz).
public final class PitchDetector {
    private let decim: Int
    private let sr: Double
    private let win = 1024
    private let hop: Int
    private let minLag: Int
    private let maxLag: Int
    private var buf: [Float]
    private var len = 0
    private var sinceHop = 0
    private var acc: Float = 0, accN = 0, lp: Float = 0
    private var diff: [Float]
    private var sq: [Float]

    public init(sampleRate: Double) {
        decim = max(1, Int((sampleRate / 16000).rounded()))
        sr = sampleRate / Double(decim)
        hop = Int((sr * 0.01).rounded())
        minLag = Int(floor(sr / 1000))
        maxLag = min(win - 2, Int(ceil(sr / 60)))
        buf = [Float](repeating: 0, count: win * 2)
        diff = [Float](repeating: 0, count: maxLag + 1)
        sq = [Float](repeating: 0, count: win + 1)
    }

    /// Process a block of samples; calls `emit` for every completed 10 ms frame.
    public func process(_ samples: UnsafeBufferPointer<Float>, emit: (PitchFrame) -> Void) {
        for x in samples {
            lp += 0.35 * (x - lp)
            acc += lp
            accN += 1
            if accN == decim { push(acc / Float(decim), emit); acc = 0; accN = 0 }
        }
    }

    public func process(_ samples: [Float], emit: (PitchFrame) -> Void) {
        samples.withUnsafeBufferPointer { process($0, emit: emit) }
    }

    private func push(_ x: Float, _ emit: (PitchFrame) -> Void) {
        if len == buf.count {
            for i in 0..<win { buf[i] = buf[buf.count - win + i] }
            len = win
        }
        buf[len] = x
        len += 1
        sinceHop += 1
        if sinceHop >= hop && len >= win {
            sinceHop = 0
            emit(analyse(start: len - win))
        }
    }

    private func analyse(start: Int) -> PitchFrame {
        let W = win
        var frame = PitchFrame(f0: 0, conf: 0, rmsDb: 0)
        buf.withUnsafeBufferPointer { b in
            let x = UnsafeBufferPointer(rebasing: b[start..<(start + W)])
            var energy: Float = 0
            for i in 0..<W { energy += x[i] * x[i] }
            let rmsDb = 10 * log10(Double(energy) / Double(W) + 1e-12)
            let half = W - maxLag
            diff[0] = 1
            var running: Float = 0
            // d(lag) = Σ(x_i − x_{i+lag})² = Σx_i² + Σx_{i+lag}² − 2·Σx_i·x_{i+lag} (vectorised dot products)
            for i in 0..<W { sq[i + 1] = sq[i] + x[i] * x[i] }
            let base = x.baseAddress!
            for lag in 1...maxLag {
                var cross: Float = 0
                #if canImport(Accelerate)
                vDSP_dotpr(base, 1, base + lag, 1, &cross, vDSP_Length(half))
                #else
                for i in 0..<half { cross += x[i] * x[i + lag] }
                #endif
                let s = max(0, sq[half] + (sq[lag + half] - sq[lag]) - 2 * cross)
                running += s
                diff[lag] = running > 0 ? (s * Float(lag)) / running : 1
            }
            var tau = -1
            var lag = minLag
            while lag < maxLag {
                if diff[lag] < 0.15 {
                    while lag + 1 < maxLag && diff[lag + 1] < diff[lag] { lag += 1 }
                    tau = lag
                    break
                }
                lag += 1
            }
            var f0 = 0.0, conf = 0.0
            if tau > 0 && rmsDb > -70 {
                let a = Double(diff[tau - 1]), bb = Double(diff[tau]), c = Double(diff[tau + 1])
                let den = a + c - 2 * bb
                let t = den != 0 ? Double(tau) + (a - c) / (2 * den) : Double(tau)
                f0 = sr / t
                conf = max(0, min(1, 1 - bb))
            }
            frame = PitchFrame(f0: f0, conf: conf, rmsDb: rmsDb)
        }
        return frame
    }

    /// Noise floor from calibration levels: 80th percentile (robust to a cough, ignores silent gaps).
    public static func noiseFloor(_ levels: [Double]) -> Double {
        guard !levels.isEmpty else { return -60 }
        let s = levels.sorted()
        return s[Int(Double(s.count) * 0.8)]
    }

    /// Same voicing gate the host and the scoring engine use.
    public static func isVoiced(_ f: PitchFrame, noiseFloorDb: Double?) -> Bool {
        f.f0 > 0 && f.conf >= 0.6 && (noiseFloorDb == nil || f.rmsDb >= noiseFloorDb! + 10)
    }
}
