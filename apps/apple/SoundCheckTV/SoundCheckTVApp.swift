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
