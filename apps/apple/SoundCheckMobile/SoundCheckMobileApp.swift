import SwiftUI
import SoundCheckKit
import SoundCheckUI

/// SoundCheck Mobile: turns the phone into a wireless mic for SoundCheck Stage on the TV.
@main
struct SoundCheckMobileApp: App {
    /// UI tests launch with --uitest-reset so every run starts signed out (the simulator keychain outlives uninstalls).
    @MainActor static var didReset = false
    @MainActor static func resetForUITests(_ backend: SoundCheckBackend) {
        guard !didReset, ProcessInfo.processInfo.arguments.contains("--uitest-reset") else { return }
        didReset = true
        Task { try? await backend.signOut() }
    }

    @State private var backend = SoundCheckBackend()
    @State private var pendingCode: String?
    @State private var tab = ProcessInfo.processInfo.environment["SC_DEV_SOLO"] == nil ? 0 : 1
    var body: some Scene {
        WindowGroup {
            let _ = Self.resetForUITests(backend)
            TabView(selection: $tab) {
                Tab("Party", systemImage: "person.3.fill", value: 0) { JoinView(backend: backend, pendingCode: $pendingCode) }
                Tab("Sing solo", systemImage: "music.mic", value: 1) { SoloHome(backend: backend) }
            }
            .tint(SC.pink)
            .preferredColorScheme(.dark)
                // soundcheck://join/ABC234 or https://<site>/join/ABC234 (QR codes on the TV)
                .onOpenURL { url in pendingCode = JoinView.code(from: url); tab = 0 }
        }
    }
}
