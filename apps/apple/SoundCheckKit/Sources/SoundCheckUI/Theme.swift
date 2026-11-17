import SwiftUI

/// SoundCheck design tokens (mirror of the web's Tailwind @theme): ink neutrals + stage gradient.
public enum SC {
    public static let ink950 = Color(hex: "#07070B")
    public static let ink900 = Color(hex: "#0E0E15")
    public static let ink850 = Color(hex: "#14141D")
    public static let ink800 = Color(hex: "#1B1B26")
    public static let ink700 = Color(hex: "#2A2A38")
    public static let ink500 = Color(hex: "#5C5C72")
    public static let ink300 = Color(hex: "#A3A3B8")
    public static let ink50 = Color(hex: "#F5F5FA")
    public static let pink = Color(hex: "#FF3D9A")
    public static let violet = Color(hex: "#8B5CFF")
    public static let cyan = Color(hex: "#38E1FF")
    public static let gold = Color(hex: "#FFC94D")
    public static let success = Color(hex: "#3DDC97")
    public static let danger = Color(hex: "#FF5E5E")
    public static let stage = LinearGradient(colors: [pink, violet], startPoint: .leading, endPoint: .trailing)
    public static let wipe = LinearGradient(colors: [cyan, pink], startPoint: .leading, endPoint: .trailing)

    public static func display(_ size: CGFloat, _ weight: Font.Weight = .heavy) -> Font { .system(size: size, weight: weight, design: .rounded) }
}

public extension Color {
    init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))).scanHexInt64(&v)
        self.init(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

/// Album art with a gradient monogram fallback (same look as the web's Artwork component). When no URL
/// is stored yet, `resolve` looks one up on demand (resolve-artwork: Cover Art Archive → iTunes).
public struct ArtworkView: View {
    let url: String?
    let title: String
    let resolve: (@Sendable () async -> String?)?
    @State private var resolved: String?
    public init(url: String?, title: String, resolve: (@Sendable () async -> String?)? = nil) { self.url = url; self.title = title; self.resolve = resolve }
    public var body: some View {
        ZStack {
            SC.stage.opacity(0.85)
            Text(title.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased())
                .font(SC.display(28)).foregroundStyle(.white)
            if let s = url ?? resolved, let u = URL(string: s) {
                AsyncImage(url: u, transaction: Transaction(animation: .easeIn(duration: 0.2))) { phase in
                    if let img = phase.image { img.resizable().scaledToFill() }
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityLabel("\(title) artwork")
        .task(id: url) {
            guard url == nil, resolved == nil, let resolve else { return }
            resolved = await ArtworkLookups.shared.run(resolve)
        }
    }
}

/// Caps concurrent artwork lookups (providers are rate limited), like the web's 4-at-a-time queue.
actor ArtworkLookups {
    static let shared = ArtworkLookups()
    private var active = 0
    private var waiters: [CheckedContinuation<Void, Never>] = []
    func run(_ f: @Sendable () async -> String?) async -> String? {
        if active >= 4 { await withCheckedContinuation { waiters.append($0) } }
        active += 1
        defer { active -= 1; if !waiters.isEmpty { waiters.removeFirst().resume() } }
        return await f()
    }
}
