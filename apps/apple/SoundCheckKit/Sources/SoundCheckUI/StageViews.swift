import SwiftUI
import SoundCheckKit

/// Karaoke lyrics: current line with a per-word colour wipe, next line dimmed below.
public struct StageLyricsView: View {
    let lines: [LyricLine]
    let notes: [RefNote]
    let time: Double
    let size: CGFloat
    public init(lines: [LyricLine], notes: [RefNote], time: Double, size: CGFloat = 64) {
        self.lines = lines; self.notes = notes; self.time = time; self.size = size
    }
    public var body: some View {
        let i = Timing.lineAt(lines, time)
        let cur = i >= 0 ? i : 0
        VStack(spacing: size * 0.35) {
            if lines.isEmpty {
                Text("♪").font(SC.display(size)).foregroundStyle(SC.ink300)
            } else {
                WipeLine(words: Timing.words(of: lines[cur], next: lines[safe: cur + 1], notes: notes), time: i >= 0 ? time : -1, size: size)
                    .id(cur)
                if let next = lines[safe: cur + 1] {
                    Text(next.text).font(SC.display(size * 0.55, .bold)).foregroundStyle(SC.ink500).multilineTextAlignment(.center)
                }
            }
        }
        .animation(.easeOut(duration: 0.25), value: cur)
        .accessibilityElement(children: .combine)
    }
}

struct WipeLine: View {
    let words: [LyricWord]
    let time: Double
    let size: CGFloat
    var body: some View {
        // Text concatenation keeps natural wrapping; each word is filled left→right by its progress.
        words.enumerated().reduce(Text("")) { acc, item in
            let (k, w) = item
            let p = Timing.progress(w, at: time)
            let word = Text(w.text + (k < words.count - 1 ? " " : ""))
            return acc + word.foregroundStyle(p >= 1 ? AnyShapeStyle(SC.wipe) : p > 0 ? AnyShapeStyle(SC.pink) : AnyShapeStyle(SC.ink50))
        }
        .font(SC.display(size))
        .multilineTextAlignment(.center)
        .lineLimit(3)
        .minimumScaleFactor(0.5)
    }
}

public struct HudTrail: Identifiable {
    public let id: String
    public let color: Color
    public let points: [(Double, Double?)]
    public init(id: String, color: Color, points: [(Double, Double?)]) { self.id = id; self.color = color; self.points = points }
}

/// Scrolling melody guide: reference notes as bars, each singer's pitch as a coloured trail (octave-folded
/// onto the reference so a low voice still lands on the bar). Now-line at 30% width; 8 s window.
public struct PitchHUD: View {
    let notes: [RefNote]
    let keyShift: Int
    let time: Double
    let trails: [HudTrail]
    let range: VocalRange?
    public init(notes: [RefNote], keyShift: Int, time: Double, trails: [HudTrail], range: VocalRange?) {
        self.notes = notes; self.keyShift = keyShift; self.time = time; self.trails = trails; self.range = range
    }
    public var body: some View {
        Canvas { ctx, size in
            let window = 8.0, nowX = size.width * 0.3
            let lo = (range?.low ?? 48) + Double(keyShift) - 3, hi = (range?.high ?? 72) + Double(keyShift) + 3
            func x(_ t: Double) -> CGFloat { nowX + CGFloat((t - time) / window) * size.width }
            func y(_ m: Double) -> CGFloat { size.height * (1 - CGFloat((m - lo) / max(1, hi - lo))) }
            for n in notes where n.end > time - window * 0.3 && n.start < time + window {
                let m = n.pitch + Double(keyShift)
                let r = CGRect(x: x(n.start), y: y(m) - 5, width: max(4, x(n.end) - x(n.start)), height: 10)
                ctx.fill(Path(roundedRect: r, cornerRadius: 5), with: .color(n.end < time ? SC.ink700 : SC.cyan))
            }
            for tr in trails {
                var path = Path(), open = false
                for (t, midi) in tr.points where t > time - window * 0.3 && t <= time {
                    guard let midi else { open = false; continue }
                    var m = midi
                    if let ref = Timing.noteAt(notes, t) {      // fold to the nearest octave of the reference
                        let target = ref + Double(keyShift)
                        m += 12 * ((target - m) / 12).rounded()
                    }
                    let p = CGPoint(x: x(t), y: y(m))
                    if open { path.addLine(to: p) } else { path.move(to: p); open = true }
                }
                ctx.stroke(path, with: .color(tr.color), style: StrokeStyle(lineWidth: 4, lineCap: .round, lineJoin: .round))
            }
            ctx.fill(Path(CGRect(x: nowX - 1, y: 0, width: 2, height: size.height)), with: .color(.white.opacity(0.8)))
        }
        .accessibilityLabel("Melody guide")
    }
}

/// One singer's SoundCheck Score card.
public struct ScoreCard: View {
    let name: String
    let color: Color
    let result: PerformanceResult
    @State private var shown = 0
    public init(name: String, color: Color, result: PerformanceResult) { self.name = name; self.color = color; self.result = result }
    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(name).font(.title3.bold()).foregroundStyle(color)
                Spacer()
                Text(result.grade.rawValue).font(SC.display(34, .black)).padding(.horizontal, 14).padding(.vertical, 2)
                    .background(SC.stage, in: RoundedRectangle(cornerRadius: 10)).foregroundStyle(SC.ink950)
            }
            Text("\(shown)").font(SC.display(96, .black)).monospacedDigit().contentTransition(.numericText())
            ForEach([("Pitch", result.pitch), ("Timing", result.timing), ("Rhythm", result.rhythm), ("Duration", result.duration),
                     ("Transitions", result.transitions), ("Stability", result.stability)].compactMap { l, v in v.map { (l, $0) } }, id: \.0) { label, v in
                VStack(alignment: .leading, spacing: 4) {
                    HStack { Text(label.uppercased()); Spacer(); Text("\(Int((v * 100).rounded()))") }.font(.caption.bold()).foregroundStyle(SC.ink300)
                    GeometryReader { g in
                        Capsule().fill(SC.ink700).overlay(alignment: .leading) { Capsule().fill(SC.stage).frame(width: g.size.width * v) }
                    }.frame(height: 8)
                }
            }
            ForEach(result.feedback, id: \.self) { Text("• \($0)").font(.callout).foregroundStyle(SC.ink300) }
        }
        .padding(28)
        .background(SC.ink850.opacity(0.92), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .task { withAnimation(.easeOut(duration: 1.2)) { shown = result.score } }
        .accessibilityElement(children: .combine)
    }
}

extension Array {
    subscript(safe i: Int) -> Element? { indices.contains(i) ? self[i] : nil }
}
