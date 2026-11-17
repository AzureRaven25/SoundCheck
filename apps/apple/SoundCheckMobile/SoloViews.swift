import SwiftUI
import SoundCheckKit
import SoundCheckUI

/// Solo singing on the phone: your karaoke-ready songs, played on the phone with its own mic scoring you.
struct SoloHome: View {
    let backend: SoundCheckBackend
    @State private var signedIn = false
    @State private var songs: [Track] = []
    @State private var loading = false
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var singing: String?

    var body: some View {
        NavigationStack {
            Group {
                if !signedIn {
                    VStack(spacing: 16) {
                        Text("Sing solo").font(SC.display(36))
                        Text("Sign in to sing the songs you’ve made karaoke-ready on SoundCheck.").foregroundStyle(SC.ink300).multilineTextAlignment(.center)
                        TextField("Email", text: $email).textContentType(.emailAddress).keyboardType(.emailAddress).textInputAutocapitalization(.never)
                            .padding(14).background(SC.ink850, in: RoundedRectangle(cornerRadius: 14))
                        SecureField("Password", text: $password).textContentType(.password)
                            .padding(14).background(SC.ink850, in: RoundedRectangle(cornerRadius: 14))
                        Button {
                            Task {
                                do { try await backend.signIn(email: email, password: password); await refresh() }
                                catch { self.error = error.localizedDescription }
                            }
                        } label: {
                            Text("Sign in").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 14).background(SC.stage, in: Capsule()).foregroundStyle(.white)
                        }
                        if let error { Text(error).foregroundStyle(SC.danger).font(.footnote) }
                    }
                    .padding(28)
                } else if loading {
                    ProgressView()
                } else if songs.isEmpty {
                    Text("No karaoke-ready songs yet. Upload your copy of a song on the SoundCheck website.")
                        .foregroundStyle(SC.ink300).multilineTextAlignment(.center).padding(32)
                } else {
                    List(songs) { t in
                        Button { singing = t.id } label: {
                            HStack(spacing: 14) {
                                ArtworkView(url: t.artworkUrl, title: t.title).frame(width: 52, height: 52)
                                VStack(alignment: .leading) { Text(t.title).font(.headline); Text(t.artistCredit).font(.subheadline).foregroundStyle(SC.ink300) }
                                Spacer()
                                Image(systemName: "music.mic").foregroundStyle(SC.pink)
                            }
                        }
                        .listRowBackground(SC.ink900)
                    }
                    .scrollContentBackground(.hidden)
                    .navigationTitle("Sing solo")
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(SC.ink950)
        }
        .task {
            await backend.validateSession()
            #if DEBUG
            // DEBUG only: SC_DEV_EMAIL / SC_DEV_PASSWORD sign in a local-stack test account; SC_DEV_SOLO=<trackId> opens it
            let env = ProcessInfo.processInfo.environment
            if let e = env["SC_DEV_EMAIL"], let p = env["SC_DEV_PASSWORD"], !(backend.currentUser.map { !$0.isAnonymous } ?? false) {
                try? await backend.signIn(email: e, password: p)
            }
            #endif
            await refresh()
            #if DEBUG
            if signedIn, let t = ProcessInfo.processInfo.environment["SC_DEV_SOLO"] { singing = t }
            #endif
        }
        .fullScreenCover(item: Binding(get: { singing.map(SongID.init) }, set: { singing = $0?.id })) { SoloStage(backend: backend, trackId: $0.id) }
    }

    struct SongID: Identifiable { let id: String }

    private func refresh() async {
        signedIn = backend.currentUser.map { !$0.isAnonymous } ?? false
        guard signedIn else { return }
        loading = true
        songs = (try? await backend.karaokeReady()) ?? []
        loading = false
    }
}

/// Phone Stage: stems on the phone, its mic → YIN frames in song time → official score.
struct SoloStage: View {
    let backend: SoundCheckBackend
    let trackId: String
    @Environment(\.dismiss) private var dismiss
    enum Phase { case loading, ready, calibrating, singing, scoring, results }
    @State private var phase: Phase = .loading
    @State private var data: StageData?
    @State private var engine = StageEngine()
    @State private var mic: MicCapture?
    @State private var keyShift = 0
    @State private var result: PerformanceResult?
    @State private var message: String?
    @State private var noiseFloor: Double?
    @State private var recorder = FrameRecorder()

    var body: some View {
        ZStack {
            SC.ink950.ignoresSafeArea()
            switch phase {
            case .loading: ProgressView(message ?? "Warming up the band…")
            case .ready:
                VStack(spacing: 22) {
                    Text(data?.track.title ?? "").font(SC.display(32)).multilineTextAlignment(.center)
                    Text("Use headphones for the best score, so the mic hears only you.").foregroundStyle(SC.ink300).multilineTextAlignment(.center)
                    Button { Task { await start() } } label: {
                        Text("Start singing").font(.title3.bold()).padding(.horizontal, 36).padding(.vertical, 16).background(SC.stage, in: Capsule()).foregroundStyle(.white)
                    }
                    if let message { Text(message).foregroundStyle(SC.danger) }
                }.padding(28)
            case .calibrating: Text("Stay quiet for a moment…").foregroundStyle(SC.ink300)
            case .singing:
                if let d = data {
                    TimelineView(.animation) { _ in
                        let t = engine.position()
                        VStack(spacing: 20) {
                            PitchHUD(notes: d.notes, keyShift: keyShift, time: t,
                                     trails: [HudTrail(id: "me", color: SC.gold, points: recorder.trail())], range: d.vocalRange)
                                .frame(height: 150).background(SC.ink900, in: RoundedRectangle(cornerRadius: 18))
                            Spacer()
                            StageLyricsView(lines: d.lines, notes: d.notes, time: t, size: 34)
                            Spacer()
                            HStack(spacing: 22) {
                                Button { keyShift = max(-6, keyShift - 1); engine.setKey(keyShift) } label: { Image(systemName: "minus.circle.fill").font(.title) }.accessibilityLabel("Key down")
                                Text(keyShift > 0 ? "+\(keyShift)" : "\(keyShift)").font(.title3.bold()).monospacedDigit()
                                Button { keyShift = min(6, keyShift + 1); engine.setKey(keyShift) } label: { Image(systemName: "plus.circle.fill").font(.title) }.accessibilityLabel("Key up")
                                Button { Task { await finish() } } label: { Label("Finish", systemImage: "stop.fill").padding(.horizontal, 16).padding(.vertical, 10).background(SC.ink800, in: Capsule()) }
                            }.foregroundStyle(SC.ink50)
                        }.padding(20)
                    }
                }
            case .scoring: ProgressView("Scoring…")
            case .results:
                VStack(spacing: 18) {
                    if let r = result { ScoreCard(name: "You", color: SC.gold, result: r) } else { Text(message ?? "").foregroundStyle(SC.ink300) }
                    Button("Done") { dismiss() }.font(.headline)
                }.padding(24)
            }
        }
        .task {
            do {
                if case .ready(let d) = try await backend.stageData(trackId: trackId) { data = d; phase = .ready }
                else { message = "This song isn’t karaoke-ready." }
            } catch { message = error.localizedDescription }
        }
        .onDisappear { engine.stop(); mic?.stop() }
    }

    private func start() async {
        guard let d = data else { return }
        guard await MicCapture.requestPermission() else { message = "Allow microphone access in Settings to be scored."; return }
        phase = .loading
        do {
            let m = MicCapture()
            let rec = recorder
            let eng = engine
            try m.start { f, capturedAt in
                Task { @MainActor in
                    guard eng.isPlaying else { return }
                    let latency = (Date().timeIntervalSince1970 * 1000 - capturedAt) / 1000
                    rec.add(t: eng.position() - latency, f, noiseFloor: noiseFloor)
                }
            }
            mic = m
            try await engine.load(instrumental: d.instrumentalURL, vocals: d.vocalsURL)
            engine.onEnded = { Task { await finish() } }
            phase = .calibrating
            noiseFloor = await m.calibrate(seconds: 1.5)
            recorder.reset()
            engine.play(from: 0)
            phase = .singing
        } catch { message = "Couldn’t start: \(error.localizedDescription)"; phase = .ready }
    }

    private func finish() async {
        guard phase == .singing else { return }
        engine.pause(); mic?.stop()
        guard recorder.count >= 100 else { message = "We didn’t capture enough singing to score."; phase = .results; return }
        phase = .scoring
        do {
            let r = try await backend.score(trackId: trackId, sessionId: nil, keyShift: keyShift,
                                            singers: [ScoreSinger(memberId: nil, frames: recorder.frames, latencyMs: 0, noiseFloorDb: noiseFloor)])
            result = r.first?.asResult
        } catch { message = "Scoring failed. Please try again." }
        phase = .results
    }
}

/// Collects pitch frames in song time (flat [t, f0, conf, rmsDb] like every client) and a short trail.
@MainActor final class FrameRecorder {
    private(set) var frames: [Double] = []
    private var recent: [(Double, Double?)] = []
    var count: Int { frames.count / SCProtocol.frameStride }
    func reset() { frames = []; recent = [] }
    func add(t: Double, _ f: PitchFrame, noiseFloor: Double?) {
        frames += [(t * 1000).rounded() / 1000, f.f0, f.conf, f.rmsDb]
        recent.append((t, PitchDetector.isVoiced(f, noiseFloorDb: noiseFloor) ? Pitch.midi(f.f0) : nil))
        if recent.count > 400 { recent.removeFirst(recent.count - 400) }
    }
    func trail() -> [(Double, Double?)] { recent }
}
