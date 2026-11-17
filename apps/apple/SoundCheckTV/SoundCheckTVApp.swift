import SwiftUI
import SoundCheckKit
import SoundCheckUI

/// SoundCheck for Apple TV: browse the catalog, preview songs, and host SoundCheck Stage / Party with
/// phones as wireless microphones.
@main
struct SoundCheckTVApp: App {
    @State private var model = AppModel()
    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .task { await model.devAutostart() }
                .fullScreenCover(item: Binding(get: { model.devStage }, set: { model.devStage = $0 })) { StageView(trackId: $0.id).environment(model) }
        }
    }
}

@MainActor @Observable
final class AppModel {
    static let sharedBackend = SoundCheckBackend()
    let backend = AppModel.sharedBackend
    var signedIn: Bool
    init() { signedIn = backend.currentUser != nil }
    func refreshAuth() { signedIn = backend.currentUser != nil }

    struct DevStage: Identifiable { let id: String }
    var devStage: DevStage?
    /// DEBUG builds only: SC_DEV_EMAIL / SC_DEV_PASSWORD sign in with a local-stack test account and
    /// SC_DEV_STAGE=<trackId> opens Stage, so simulator tests needn't type on the TV keyboard.
    func devAutostart() async {
        await backend.validateSession()
        refreshAuth()
        #if DEBUG
        let env = ProcessInfo.processInfo.environment
        if let e = env["SC_DEV_EMAIL"], let p = env["SC_DEV_PASSWORD"], backend.currentUser == nil {
            do { try await backend.signIn(email: e, password: p) } catch { NSLog("[soundcheck] dev sign-in failed: \(error)") }
            refreshAuth()
            NSLog("[soundcheck] dev sign-in: signedIn=\(signedIn)")
        }
        if let t = env["SC_DEV_STAGE"], signedIn { devStage = DevStage(id: t) }
        #endif
    }
}

extension View {
    /// Artwork resolver for a track's album (nil when the track has no album).
    @MainActor func art(_ t: Track) -> (@Sendable () async -> String?)? {
        guard let albumId = t.albumId else { return nil }
        let backend = AppModel.sharedBackend
        return { await backend.resolveArtwork(albumId: albumId) }
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            Tab("Home", systemImage: "house") { NavigationStack { HomeView() } }
            Tab("Search", systemImage: "magnifyingglass") { NavigationStack { SearchView() } }
            Tab("Account", systemImage: "person.crop.circle") { NavigationStack { AccountView() } }
        }
        .background(SC.ink950)
    }
}
