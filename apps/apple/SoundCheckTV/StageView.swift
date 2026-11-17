import CoreImage.CIFilterBuiltins
import SwiftUI
import SoundCheckKit
import SoundCheckUI

/// SoundCheck Stage / Party on Apple TV. The TV has no microphone, so singers use their phones:
/// lobby (QR + code) → band warms up → sing (lyrics wipe, melody guide, per-singer trails) → scores.
struct StageView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let trackId: String

    enum Phase { case loading, lobby, warming, singing, scoring, results }
    @State private var phase: Phase = .loading
    @State private var data: StageData?
    @State private var message: String?
    @State private var host: PartyHost?
    @State private var engine = StageEngine()
    @State private var keyShift = 0
    @State private var guide: Float = 0
    @State private var rates: [String: Double] = [:]
    @State private var results: [(PartySinger, PerformanceResult)] = []
    @FocusState private var startFocused: Bool

    var body: some View {
        ZStack {
            SC.ink950.ignoresSafeArea()
            if let d = data, let art = d.track.artworkUrl, let u = URL(string: art) {
                AsyncImage(url: u) { $0.image?.resizable().scaledToFill() }.blur(radius: 80).opacity(0.25).ignoresSafeArea()
            }
            content
        }
        .task { await load() }
        .onDisappear { engine.stop(); if let host { Task { await host.close() } } }
        .onExitCommand { dismiss() }
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            ProgressView(message ?? "Setting the stage…")
        case .lobby:
            if let host, let d = data { lobby(host, d) }
        case .warming:
            ProgressView("Warming up the band…")
        case .singing:
            if let d = data, let host { singing(d, host) }
        case .scoring:
            ProgressView("Scoring everyone…")
        case .results:
            resultsView
        }
    }

    // MARK: Lobby
    private func lobby(_ host: PartyHost, _ d: StageData) -> some View {
        HStack(spacing: 90) {
            VStack(spacing: 20) {
                if let code = host.session?.code {
                    QRCodeImage(text: model.backend.joinURL(code: code).absoluteString).frame(width: 360, height: 360)
                        .padding(18).background(.white, in: RoundedRectangle(cornerRadius: 24))
                }
            }
            VStack(alignment: .leading, spacing: 26) {
                Text(d.track.title).font(SC.display(52, .black)).lineLimit(2)
                Text(d.track.artistCredit).font(.title3).foregroundStyle(SC.ink300)
                if let code = host.session?.code {
                    Text("Scan with your phone, or open \(joinHost)/join and enter").foregroundStyle(SC.ink300)
                    Text(code).font(SC.display(110, .black)).kerning(18).accessibilityLabel("Pairing code \(code.map(String.init).joined(separator: " "))")
                }
                VStack(alignment: .leading, spacing: 10) {
                    if host.singers.isEmpty { Text("Waiting for singers…").foregroundStyle(SC.ink500) }
                    ForEach(host.singers) { s in
                        HStack(spacing: 14) {
                            Circle().fill(Color(hex: s.color)).frame(width: 18, height: 18)
                            Text(s.name).bold()
                            Text(s.mic == .ready ? "mic ready" : "mic off").font(.caption).foregroundStyle(s.mic == .ready ? SC.success : SC.ink500)
                        }
                    }
                }
                if let err = host.error ?? message { Text(err).foregroundStyle(SC.danger) }
                Button { Task { await start() } } label: { Label("Start singing", systemImage: "play.fill").font(.title3.bold()) }
                    .disabled(host.readySingers.isEmpty)
                    .focused($startFocused)
                    // the button is disabled (unfocusable) until a phone's mic is ready: hand focus to it then
                    .onChange(of: host.readySingers.count) { _, n in
                        if n > 0 { startFocused = true }
                        #if DEBUG
                        if n > 0, ProcessInfo.processInfo.environment["SC_DEV_AUTOSTART"] != nil, phase == .lobby { Task { await start() } }
                        #endif
                    }
            }
        }
        .padding(80)
    }

    private var joinHost: String {
        let u = model.backend.config.siteURL
        return (u.host() ?? "") + (u.port.map { ":\($0)" } ?? "")
    }

    // MARK: Singing
    private func singing(_ d: StageData, _ host: PartyHost) -> some View {
        TimelineView(.animation) { _ in
            let t = engine.position()
            VStack(spacing: 30) {
                HStack {
                    Text(d.track.title).font(.title3.bold())
                    Spacer()
                    if let key = Pitch.transposeKey(d.musicalKey, by: keyShift) { chip("KEY \(key.uppercased())", SC.ink50) }
                    ForEach(host.singers) { s in chip("\(s.name.uppercased())\(rates[s.memberId].map { " \(Int($0 * 100))%" } ?? "")", Color(hex: s.color)) }
                }
                PitchHUD(notes: d.notes, keyShift: keyShift, time: t,
                         trails: host.singers.map { HudTrail(id: $0.memberId, color: Color(hex: $0.color), points: host.trail($0)) },
                         range: d.vocalRange)
                    .frame(height: 220).background(SC.ink900.opacity(0.6), in: RoundedRectangle(cornerRadius: 24))
                Spacer()
                StageLyricsView(lines: d.lines, notes: d.notes, time: t, size: 76)
                Spacer()
                HStack(spacing: 40) {
                    Button { engine.isPlaying ? pause() : resume() } label: { Image(systemName: engine.isPlaying ? "pause.fill" : "play.fill") }
                    Button { Task { await finish() } } label: { Label("Finish", systemImage: "stop.fill") }
                    Button { setKey(keyShift - 1) } label: { Image(systemName: "minus") }.accessibilityLabel("Key down")
                    Text(keyShift > 0 ? "+\(keyShift)" : "\(keyShift)").font(.title3.bold()).monospacedDigit().frame(width: 60)
                    Button { setKey(keyShift + 1) } label: { Image(systemName: "plus") }.accessibilityLabel("Key up")
                    Button { guide = guide > 0 ? 0 : 0.6; engine.setGuide(guide) } label: { Label(guide > 0 ? "Guide vocal on" : "Guide vocal off", systemImage: "person.wave.2") }
                }
            }
            .padding(60)
        }
        .task(id: phase) {           // live scores ~2 Hz: TV chips + each phone's HUD
            while phase == .singing && !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(500))
                rates = host.liveRates(notes: d.notes, keyShift: keyShift)
                host.send(.liveScore(LiveScoreEvent(scores: rates.map { .init(memberId: $0.key, hitRate: $0.value, combo: 0) })))
            }
        }
    }

    private func chip(_ s: String, _ c: Color) -> some View {
        Text(s).font(.caption.bold()).padding(.horizontal, 14).padding(.vertical, 8).background(SC.ink800, in: RoundedRectangle(cornerRadius: 8)).foregroundStyle(c)
    }

    private var resultsView: some View {
        VStack(spacing: 40) {
            Text("SoundCheck Score").font(SC.display(64, .black))
            if let message { Text(message).foregroundStyle(SC.danger) }
            HStack(alignment: .top, spacing: 40) {
                ForEach(results, id: \.0.memberId) { s, r in ScoreCard(name: s.name, color: Color(hex: s.color), result: r).frame(maxWidth: 520) }
            }
            HStack(spacing: 40) {
                Button { Task { await again() } } label: { Label("Sing again", systemImage: "arrow.counterclockwise") }
                Button("Done") { dismiss() }
            }
        }
        .padding(60)
    }

    // MARK: Flow
    private func load() async {
        do {
            switch try await model.backend.stageData(trackId: trackId) {
            case .ready(let d):
                data = d
                let h = PartyHost(backend: model.backend, platform: .tvos)
                h.position = { [engine] in engine.position() }
                host = h
                await h.open(trackId: trackId)
                phase = .lobby
            case .notReady(let title): message = "“\(title)” isn’t karaoke-ready yet."
            case .signedOut: message = "Sign in on the Account tab to sing."
            }
        } catch { message = "Couldn’t open Stage: \(error.localizedDescription)" }
    }

    private func start() async {
        guard let d = data, let host else { return }
        phase = .warming
        do {
            if engine.duration == 0 {
                try await engine.load(instrumental: d.instrumentalURL, vocals: d.vocalsURL)
                engine.onEnded = { Task { await finish() } }
            }
            engine.setKey(keyShift); engine.setGuide(guide)
            host.resetTake()
            engine.play(from: 0)
            host.publishTransport(.playing, songPos: 0, keyShift: keyShift, trackId: d.track.id)
            phase = .singing
        } catch { message = "Couldn’t load the karaoke tracks."; phase = .lobby }
    }

    private func pause() { engine.pause(); host?.publishTransport(.paused, songPos: engine.position(), keyShift: keyShift, trackId: trackId) }
    private func resume() { engine.play(); host?.publishTransport(.playing, songPos: engine.position(), keyShift: keyShift, trackId: trackId) }
    private func setKey(_ k: Int) {
        keyShift = max(-6, min(6, k)); engine.setKey(keyShift)
        if engine.isPlaying { host?.publishTransport(.playing, songPos: engine.position(), keyShift: keyShift, trackId: trackId) }
    }

    private func finish() async {
        guard phase == .singing, let host, let session = host.session else { return }
        engine.pause()
        host.publishTransport(.ended, songPos: engine.position(), keyShift: keyShift, trackId: trackId)
        let singers = host.singers.filter { host.framesOf($0.memberId).count >= 400 }
        guard !singers.isEmpty else { message = "We didn’t hear any phones. Check that each singer turned their mic on."; results = []; phase = .results; return }
        phase = .scoring
        do {
            let scored = try await model.backend.score(trackId: trackId, sessionId: session.id, keyShift: keyShift, singers: singers.map {
                ScoreSinger(memberId: $0.memberId, frames: host.framesOf($0.memberId), latencyMs: nil, noiseFloorDb: $0.noiseFloorDb)
            })
            let byId = Dictionary(uniqueKeysWithValues: singers.map { ($0.memberId, $0) })
            results = scored.compactMap { r in byId[r.member_id ?? ""].map { ($0, r.asResult) } }
            host.send(.results(ResultsEvent(trackId: trackId, performances: scored.map(\.asResult))))
            message = nil
        } catch { message = "Scoring failed. Please try again." }
        phase = .results
    }

    private func again() async { results = []; message = nil; phase = .lobby }
}

/// Crisp QR code (CoreImage) for the phone join link.
struct QRCodeImage: View {
    let text: String
    var body: some View {
        if let img = Self.make(text) { Image(decorative: img, scale: 1).interpolation(.none).resizable().scaledToFit().accessibilityLabel("QR code to join") }
    }
    static func make(_ s: String) -> CGImage? {
        let f = CIFilter.qrCodeGenerator()
        f.message = Data(s.utf8); f.correctionLevel = "M"
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 12, y: 12)) else { return nil }
        return CIContext().createCGImage(out, from: out.extent)
    }
}
