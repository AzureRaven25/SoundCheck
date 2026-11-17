// swift-tools-version: 6.0
import PackageDescription

// SoundCheckKit: shared by SoundCheck for Apple TV (tvOS) and SoundCheck Mobile (iOS).
//   SoundCheckCore: dependency-free logic (realtime protocol, clock sync, lyric timing, pitch detection);
//                   mirrors packages/contracts + packages/scoring and is tested against the same golden fixtures.
//   SoundCheckKit:  Supabase-backed services (catalog, Stage data, sessions/Realtime) and AVAudioEngine playback.
//   SoundCheckUI:   SwiftUI building blocks shared by both apps (theme, artwork, lyric wipe, pitch HUD, results).
let package = Package(
    name: "SoundCheckKit",
    platforms: [.iOS(.v18), .tvOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "SoundCheckCore", targets: ["SoundCheckCore"]),
        .library(name: "SoundCheckKit", targets: ["SoundCheckKit"]),
        .library(name: "SoundCheckUI", targets: ["SoundCheckUI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/supabase/supabase-swift.git", from: "2.0.0"),
    ],
    targets: [
        .target(name: "SoundCheckCore"),
        .target(name: "SoundCheckKit", dependencies: ["SoundCheckCore", .product(name: "Supabase", package: "supabase-swift")],
                swiftSettings: [.swiftLanguageMode(.v5)]),
        .target(name: "SoundCheckUI", dependencies: ["SoundCheckKit"], swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(name: "SoundCheckCoreTests", dependencies: ["SoundCheckCore"]),
    ]
)
