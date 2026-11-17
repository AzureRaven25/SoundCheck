import Foundation

/// Lyric and melody timing helpers (mirror apps/web/src/stage/StageLyrics.tsx and packages/scoring).
public enum Timing {
    /// Index of the line active at t (last line whose start ≤ t), -1 before the first.
    public static func lineAt(_ lines: [LyricLine], _ t: Double) -> Int {
        var lo = 0, hi = lines.count - 1, ans = -1
        while lo <= hi {
            let mid = (lo + hi) >> 1
            if (lines[mid].start ?? .infinity) <= t { ans = mid; lo = mid + 1 } else { hi = mid - 1 }
        }
        return ans
    }

    /// Words for a line: real word timing when available, else spread over the sung notes of the line.
    public static func words(of line: LyricLine, next: LyricLine?, notes: [RefNote]) -> [LyricWord] {
        if let w = line.words, !w.isEmpty { return w }
        let start = line.start ?? 0
        let end = next?.start ?? line.end ?? start + 4
        let sungEnd = max(start + 0.5, notes.filter { $0.start >= start - 0.1 && $0.start < end }.map(\.end).max() ?? 0)
        let words = line.text.split(whereSeparator: \.isWhitespace).map(String.init)
        let total = Double(words.reduce(0) { $0 + max(1, $1.count) })
        var acc = start
        return words.map { w in
            let d = (sungEnd - start) * Double(max(1, w.count)) / total
            defer { acc += d }
            return LyricWord(start: acc, end: acc + d, text: w)
        }
    }

    /// Fill fraction 0…1 of a word at time t (drives the karaoke wipe).
    public static func progress(_ w: LyricWord, at t: Double) -> Double {
        if t <= w.start { return 0 }
        if t >= w.end { return 1 }
        return (t - w.start) / max(0.001, w.end - w.start)
    }

    /// Reference MIDI pitch of the note sounding at t (binary search), nil between notes.
    public static func noteAt(_ notes: [RefNote], _ t: Double) -> Double? {
        var lo = 0, hi = notes.count - 1
        while lo <= hi {
            let m = (lo + hi) >> 1
            if notes[m].end <= t { lo = m + 1 } else if notes[m].start > t { hi = m - 1 } else { return notes[m].pitch }
        }
        return nil
    }
}

public enum Pitch {
    public static func hzToCents(_ hz: Double) -> Double { 1200 * log2(hz / 440) + 6900 }
    public static func midi(_ hz: Double) -> Double { 69 + 12 * log2(hz / 440) }
    static func folded(_ cents: Double, _ target: Double) -> Double {
        let d = ((cents - target).truncatingRemainder(dividingBy: 1200) + 1200).truncatingRemainder(dividingBy: 1200)
        return min(d, 1200 - d)
    }
    /// Live HUD hit test (same rule as @soundcheck/scoring liveHit): within a semitone, any octave.
    public static func liveHit(f0: Double, refMidi: Double?, keyShift: Int = 0) -> Bool? {
        guard let ref = refMidi, f0 > 0 else { return nil }
        return folded(hzToCents(f0), (ref + Double(keyShift)) * 100) <= 100
    }
    public static func grade(_ score: Int) -> Grade { score >= 95 ? .S : score >= 85 ? .A : score >= 70 ? .B : score >= 55 ? .C : .D }

    static let names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]
    static let plain = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    /// "A minor" shifted by n semitones → "B♭ minor".
    public static func transposeKey(_ key: String?, by n: Int) -> String? {
        guard let key else { return nil }
        let parts = key.split(separator: " ", maxSplits: 1).map(String.init)
        guard let i = plain.firstIndex(of: parts.first ?? "") else { return key }
        return "\(names[((i + n) % 12 + 12) % 12]) \(parts.count > 1 ? parts[1] : "")".trimmingCharacters(in: .whitespaces)
    }
}
