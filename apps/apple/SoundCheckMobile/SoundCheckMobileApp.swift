import SwiftUI
import SoundCheckKit
import SoundCheckUI

/// SoundCheck Mobile: turns the phone into a wireless mic for SoundCheck Stage on the TV.
@main
struct SoundCheckMobileApp: App {
    @State private var backend = SoundCheckBackend()
    @State private var pendingCode: String?
    var body: some Scene {
        WindowGroup {
            JoinView(backend: backend, pendingCode: $pendingCode)
                .preferredColorScheme(.dark)
                // soundcheck://join/ABC123 or https://<site>/join/ABC123 (QR codes on the TV)
                .onOpenURL { url in pendingCode = JoinView.code(from: url) }
        }
    }
}
