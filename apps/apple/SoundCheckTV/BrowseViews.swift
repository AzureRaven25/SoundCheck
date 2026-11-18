import AVKit
import SwiftUI
import SoundCheckKit
import SoundCheckUI

struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var ready: [Track] = []
    @State private var popular: [Track] = []
    @State private var full: [Track] = []
    @State private var genres: [(String, [Track])] = []
    private static let homeGenres = [("pop", "Pop"), ("rock", "Rock"), ("hip-hop", "Hip-hop"), ("electronic", "Electronic"), ("folk", "Folk & acoustic")]
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 48) {
                HStack(spacing: 16) {
                    Text("SoundCheck").font(SC.display(56, .black))
                    Text("STAGE").font(.caption.bold()).padding(.horizontal, 12).padding(.vertical, 6).background(SC.stage, in: Capsule())
                }
                if !ready.isEmpty { TrackRow(title: "Ready to sing", tracks: ready) }
                if !full.isEmpty { TrackRow(title: "Full songs, free to play", tracks: full) }
                ForEach(genres, id: \.0) { g in TrackRow(title: g.0, tracks: g.1) }
                TrackRow(title: "Popular right now", tracks: popular)
                if let error { Text(error).foregroundStyle(SC.danger) }
            }
            .padding(.horizontal, 80).padding(.vertical, 40)
        }
        .task(id: model.signedIn) {
            do {
                async let p = model.backend.popular(limit: 40)
                // signed in: your karaoke tracks plus shared ones; signed out: the shared ones anyone can sing
                async let r = model.signedIn ? model.backend.karaokeReady() : model.backend.readyToSing()
                async let f = model.backend.fullLength()
                (popular, ready, full) = try await (p, r, (try? await f) ?? [])
                var rows: [(String, [Track])] = []
                for (slug, label) in Self.homeGenres {
                    if let t = try? await model.backend.genre(slug, limit: 20), !t.isEmpty { rows.append((label, t)) }
                }
                genres = rows
            } catch { self.error = "Couldn’t load the catalog: \(error.localizedDescription)" }
        }
    }
}

struct TrackRow: View {
    let title: String
    let tracks: [Track]
    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(title).font(.title2.bold())
            ScrollView(.horizontal) {
                LazyHStack(spacing: 40) {
                    ForEach(tracks) { t in
                        NavigationLink(value: t) {
                            VStack(alignment: .leading, spacing: 10) {
                                ArtworkView(url: t.artworkUrl, title: t.title, resolve: art(t)).frame(width: 260, height: 260)
                                Text(t.title).font(.headline).lineLimit(1)
                                Text(t.artistCredit).font(.subheadline).foregroundStyle(SC.ink300).lineLimit(1)
                            }.frame(width: 260)
                        }
                        .buttonStyle(.borderless)
                    }
                }.padding(.vertical, 30)
            }
            .scrollClipDisabled()
        }
        .navigationDestination(for: Track.self) { TrackDetailView(track: $0) }
    }
}

struct SearchView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var results: [Track] = []
    @State private var searching = false
    var body: some View {
        ScrollView {
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(260), spacing: 40), count: 6), spacing: 50) {
                ForEach(results) { t in
                    NavigationLink(value: t) {
                        VStack(alignment: .leading, spacing: 8) {
                            ArtworkView(url: t.artworkUrl, title: t.title, resolve: art(t)).frame(width: 260, height: 260)
                            Text(t.title).font(.headline).lineLimit(1)
                            Text(t.artistCredit).font(.subheadline).foregroundStyle(SC.ink300).lineLimit(1)
                        }
                    }.buttonStyle(.borderless)
                }
            }
            .padding(60)
            if searching { ProgressView() }
            if !searching && results.isEmpty && !query.isEmpty { Text("No songs found").foregroundStyle(SC.ink300) }
        }
        .searchable(text: $query, prompt: "Songs, artists, albums")
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard q.count >= 2 else { results = []; return }
            try? await Task.sleep(for: .milliseconds(350))     // debounce
            guard !Task.isCancelled else { return }
            searching = true
            results = (try? await model.backend.search(q)) ?? []
            searching = false
        }
        .navigationDestination(for: Track.self) { TrackDetailView(track: $0) }
    }
}

struct TrackDetailView: View {
    @Environment(AppModel.self) private var model
    let track: Track
    @State private var ready = false
    @State private var player: AVPlayer?
    @State private var attribution: URL?
    @State private var previewState = "Play"
    @State private var sourceLabel: String?
    @State private var stage = false

    var body: some View {
        HStack(alignment: .top, spacing: 80) {
            ArtworkView(url: track.artworkUrl, title: track.title, resolve: art(track)).frame(width: 520, height: 520).shadow(radius: 40)
            VStack(alignment: .leading, spacing: 24) {
                Text(track.title).font(SC.display(64, .black)).lineLimit(2)
                Text(track.artistCredit).font(.title2).foregroundStyle(SC.ink300)
                HStack(spacing: 18) {
                    if let a = track.albumTitle { Text(a) }
                    if let y = track.releaseYear { Text(String(y)) }
                    Text(track.durationText)
                }.foregroundStyle(SC.ink500)
                HStack(spacing: 30) {
                    if ready {
                        Button { stage = true } label: { Label("Sing on Stage", systemImage: "music.mic") }
                    }
                    Button { Task { await togglePreview() } } label: { Label(previewState, systemImage: player?.rate ?? 0 > 0 ? "pause.fill" : "play.fill") }
                }.padding(.top, 20)
                if !ready {
                    Text(model.signedIn ? "Karaoke tracks for this song aren’t ready yet. Upload your copy on the SoundCheck website to sing it here."
                                        : "Sign in to sing your karaoke-ready songs on Stage.")
                        .foregroundStyle(SC.ink300).frame(maxWidth: 800, alignment: .leading)
                }
                if let sourceLabel { Text(sourceLabel).font(.caption).foregroundStyle(SC.ink300) }
            }
            Spacer()
        }
        .padding(80)
        .task { ready = model.signedIn ? await model.backend.isKaraokeReady(trackId: track.id) : false }
        .onDisappear { player?.pause() }
        .fullScreenCover(isPresented: $stage) { StageView(trackId: track.id).environment(model) }
    }

    private func togglePreview() async {
        if let p = player { if p.rate > 0 { p.pause(); previewState = "Play" } else { p.play(); previewState = "Pause" }; return }
        previewState = "Loading…"
        guard let src = await model.backend.listenSource(trackId: track.id) else { previewState = "Not available"; return }
        sourceLabel = (src.full ? "Full track · " : "") + src.label
        attribution = src.credit
        let p = AVPlayer(url: src.url)
        player = p
        p.play()
        previewState = "Pause"
    }
}

struct AccountView: View {
    @Environment(AppModel.self) private var model
    @State private var email = ""
    @State private var password = ""
    @State private var name = ""
    @State private var creating = false
    @State private var error: String?
    @State private var busy = false
    @State private var useEmail = false

    var body: some View {
        VStack(spacing: 30) {
            if model.signedIn {
                Text("Signed in as \(model.backend.displayName)").font(.title2)
                Button("Sign out") { Task { try? await model.backend.signOut(); model.refreshAuth() } }
            } else if !useEmail {
                PhoneSignIn(onSignedIn: { model.refreshAuth() })
                Button("Use email and password instead") { useEmail = true }
            } else {
                Text(creating ? "Create your SoundCheck account" : "Sign in to SoundCheck").font(SC.display(48))
                if creating { TextField("Display name", text: $name) }
                TextField("Email", text: $email).textContentType(.emailAddress)
                SecureField("Password", text: $password)
                Button(busy ? "Please wait…" : creating ? "Sign up" : "Sign in") { Task { await submit() } }.disabled(busy)
                Button(creating ? "I already have an account" : "Create an account") { creating.toggle() }
                Button("Sign in with your phone instead") { useEmail = false }
                if let error { Text(error).foregroundStyle(SC.danger) }
            }
        }
        .frame(maxWidth: 900)
        .padding(80)
    }

    private func submit() async {
        busy = true; error = nil
        do {
            if creating { try await model.backend.signUp(email: email, password: password, displayName: name.isEmpty ? "Singer" : name) }
            else { try await model.backend.signIn(email: email, password: password) }
            model.refreshAuth()
        } catch { self.error = error.localizedDescription }
        busy = false
    }
}


/// Sign in on the TV with your phone: show a code + QR, the phone approves it at /activate, the TV polls.
struct PhoneSignIn: View {
    @Environment(AppModel.self) private var model
    let onSignedIn: () -> Void
    @State private var session: SoundCheckBackend.DeviceSignIn?
    @State private var error: String?

    var body: some View {
        HStack(spacing: 70) {
            if let s = session {
                QRCodeImage(text: s.activateURL).frame(width: 300, height: 300).padding(16).background(.white, in: RoundedRectangle(cornerRadius: 22))
            }
            VStack(alignment: .leading, spacing: 18) {
                Text("Sign in with your phone").font(SC.display(48))
                if let s = session {
                    Text("Scan the code, or open \(s.verification_url.replacingOccurrences(of: "https://", with: "")) on a signed-in phone and enter").foregroundStyle(SC.ink300)
                    Text(s.user_code).font(SC.display(96, .black)).kerning(16)
                        .accessibilityLabel("Sign-in code \(s.user_code.map(String.init).joined(separator: " "))")
                } else {
                    ProgressView()
                }
                if let error { Text(error).foregroundStyle(SC.danger) }
            }
        }
        .task {
            // start, then poll; a fresh code is issued when one expires
            while !Task.isCancelled {
                do {
                    let s = try await model.backend.startDeviceSignIn(platform: .tvos)
                    session = s; error = nil
                    while !Task.isCancelled {
                        try await Task.sleep(for: .seconds(s.interval))
                        switch try await model.backend.pollDeviceSignIn(s) {
                        case .pending: continue
                        case .signedIn: onSignedIn(); return
                        case .expired: break
                        }
                        break
                    }
                } catch {
                    self.error = "Can’t reach SoundCheck. Retrying…"
                    try? await Task.sleep(for: .seconds(5))
                }
            }
        }
    }
}
