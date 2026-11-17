import SwiftUI
import VisionKit
import SoundCheckKit
import SoundCheckUI

struct JoinView: View {
    let backend: SoundCheckBackend
    @Binding var pendingCode: String?
    @AppStorage("stageName") private var name = ""
    @State private var code = ""
    @State private var scanning = false
    @State private var guest: PartyGuest?
    @State private var joining = false

    static func code(from url: URL) -> String? {
        let parts = url.pathComponents.filter { $0 != "/" }
        if let i = parts.firstIndex(of: "join"), i + 1 < parts.count { return clean(parts[i + 1]) }
        if url.host() == "join", let c = parts.first { return clean(c) }
        return nil
    }
    static func clean(_ s: String) -> String { String(s.uppercased().filter { "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains($0) }.prefix(6)) }

    var body: some View {
        ZStack {
            SC.ink950.ignoresSafeArea()
            if let guest, guest.joined != nil {
                MicView(guest: guest, name: name) { Task { await guest.leave(); self.guest = nil } }
            } else {
                form
            }
        }
        .onChange(of: pendingCode) { _, c in if let c { code = c; pendingCode = nil } }
        .sheet(isPresented: $scanning) {
            QRScanner { url in
                if let u = URL(string: url), let c = Self.code(from: u) { code = c }
                scanning = false
            }.ignoresSafeArea()
        }
    }

    private var form: some View {
        VStack(spacing: 26) {
            Text("SOUNDCHECK PARTY").font(.caption.bold()).kerning(4).foregroundStyle(SC.pink)
            Text("Join the stage").font(SC.display(40))
            Text("Enter the 6-character code on the TV.").foregroundStyle(SC.ink300)
            TextField("ABC234", text: $code)
                .onChange(of: code) { _, v in let c = Self.clean(v); if c != v { code = c } }
                .font(SC.display(40, .bold)).kerning(10).multilineTextAlignment(.center)
                .textInputAutocapitalization(.characters).autocorrectionDisabled()
                .padding(.vertical, 16).background(SC.ink850, in: RoundedRectangle(cornerRadius: 18))
                .accessibilityLabel("Pairing code")
            TextField("Your stage name", text: $name)
                .font(.title3.bold()).multilineTextAlignment(.center)
                .padding(.vertical, 14).background(SC.ink850, in: RoundedRectangle(cornerRadius: 18))
                .accessibilityLabel("Stage name")
            Button { Task { await join() } } label: {
                Text(joining ? "Joining…" : "Join").font(.title3.bold()).frame(maxWidth: .infinity).padding(.vertical, 16)
                    .background(SC.stage, in: Capsule()).foregroundStyle(.white)
            }.disabled(code.count != 6 || joining)
            if DataScannerViewController.isSupported {
                Button { scanning = true } label: { Label("Scan the QR code", systemImage: "qrcode.viewfinder") }
            }
            if let e = guest?.error { Text(e).foregroundStyle(SC.danger).multilineTextAlignment(.center) }
        }
        .padding(28)
    }

    private func join() async {
        joining = true
        let g = PartyGuest(backend: backend, platform: .ios)
        guest = g
        await g.join(code: code, displayName: name)
        joining = false
    }
}

/// Live phone-mic screen: tap to turn the mic on (permission → calibration), then lyrics + level + score.
struct MicView: View {
    @Bindable var guest: PartyGuest
    let name: String
    let leave: () -> Void
    @State private var mic: MicCapture?
    @State private var state = "off"   // off | calibrating | live | denied
    @State private var level = 0.0

    var body: some View {
        VStack(spacing: 26) {
            if let r = guest.result {
                Text("SOUNDCHECK SCORE").font(.caption.bold()).kerning(3).foregroundStyle(SC.ink300)
                ScoreCard(name: name.isEmpty ? "You" : name, color: Color(hex: guest.joined?.color ?? "#FF3D9A"), result: r)
            } else {
                Text(guest.transportState == .playing ? "LIVE" : guest.transportState == .paused ? "PAUSED" : "WAITING FOR THE SONG")
                    .font(.caption.bold()).kerning(3).foregroundStyle(SC.ink500)
                Text(guest.line).font(SC.display(30, .bold)).multilineTextAlignment(.center).frame(minHeight: 110)
                    .accessibilityAddTraits(.updatesFrequently)
                micButton
                if let hr = guest.hitRate { Text("On pitch \(Int(hr * 100))%").font(SC.display(26, .bold)) }
                if guest.muted { Text("The host muted your mic").foregroundStyle(SC.gold) }
                if state == "denied" { Text("Allow microphone access in Settings to sing.").foregroundStyle(SC.danger) }
            }
            Button("Leave", role: .destructive) { mic?.stop(); leave() }.padding(.top, 20)
        }
        .padding(28)
        .task(id: state) {
            while state == "live" && !Task.isCancelled {
                guest.refreshLine()
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
        .onDisappear { mic?.stop() }
    }

    private var micButton: some View {
        let color = Color(hex: guest.joined?.color ?? "#FF3D9A")
        return Button { Task { await micOn() } } label: {
            ZStack {
                Circle().fill(color.opacity(0.18))
                Circle().fill(color.opacity(0.4)).scaleEffect(0.6 + level * 0.4)
                Image(systemName: guest.muted ? "mic.slash.fill" : "mic.fill").font(.system(size: 64)).foregroundStyle(state == "live" ? .white : SC.ink950)
            }
            .frame(width: 190, height: 190)
            .background(state == "live" ? Color.clear : color, in: Circle())
        }
        .disabled(state != "off" && state != "denied")
        .accessibilityLabel(state == "live" ? "Microphone on" : "Turn on my microphone")
        .overlay(alignment: .bottom) {
            Text(state == "calibrating" ? "Stay quiet for a second…" : state == "off" ? "Tap to turn on your mic" : "")
                .font(.footnote).foregroundStyle(SC.ink500).offset(y: 36)
        }
    }

    private func micOn() async {
        guard await MicCapture.requestPermission() else { state = "denied"; return }
        let m = MicCapture()
        do {
            state = "calibrating"
            try m.start { [weak guest] f, at in
                let lv = max(0, min(1, (f.rmsDb + 60) / 50))
                Task { @MainActor in
                    level = lv
                    guest?.push(f, capturedAtMs: at)
                }
            }
            mic = m
            let floor = await m.calibrate(seconds: 1.5)
            await guest.micReady(noiseFloorDb: floor, latencyMs: m.inputLatencyMs)
            UIApplication.shared.isIdleTimerDisabled = true     // keep the screen on while singing
            state = "live"
        } catch { state = "off" }
    }
}

/// QR scanner (VisionKit Live Text). Hands back the first QR payload it sees.
struct QRScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void
    func makeUIViewController(context: Context) -> DataScannerViewController {
        let vc = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], isHighlightingEnabled: true)
        vc.delegate = context.coordinator
        try? vc.startScanning()
        return vc
    }
    func updateUIViewController(_ vc: DataScannerViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }
    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        init(onCode: @escaping (String) -> Void) { self.onCode = onCode }
        func dataScanner(_ s: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
            for case let .barcode(b) in items { if let v = b.payloadStringValue { onCode(v); return } }
        }
    }
}
