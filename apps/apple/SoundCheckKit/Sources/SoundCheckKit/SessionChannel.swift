import Foundation
import Supabase

/// The private Realtime channel `session:<id>` (RLS on realtime.messages admits only the session's
/// host and members). Messages are SoundCheck protocol events in broadcast event "sc", byte-compatible
/// with the web (apps/web/src/session/channel.ts) and Android clients.
@MainActor
public final class SessionChannel {
    public let channel: RealtimeChannelV2
    private let backend: SoundCheckBackend
    private var tasks: [Task<Void, Never>] = []
    private var presence: [String: PresenceState] = [:]

    private init(channel: RealtimeChannelV2, backend: SoundCheckBackend) { self.channel = channel; self.backend = backend }

    public static func open(
        backend: SoundCheckBackend, sessionId: String, presenceKey: String,
        onEvent: @escaping @MainActor (SessionEvent) -> Void,
        onPresence: (@MainActor ([PresenceState]) -> Void)? = nil
    ) async throws -> SessionChannel {
        let client = backend.client
        // private-channel authorization uses the signed-in (or anonymous) user's JWT
        await client.realtimeV2.setAuth(try? await client.auth.session.accessToken)
        let ch = client.channel(SCProtocol.channelName(sessionId)) {
            $0.isPrivate = true
            $0.broadcast.receiveOwnBroadcasts = false
            $0.broadcast.acknowledgeBroadcasts = false
            $0.presence.key = presenceKey
        }
        let sc = SessionChannel(channel: ch, backend: backend)
        let broadcasts = ch.broadcastStream(event: SCProtocol.broadcastEvent)
        sc.tasks.append(Task { @MainActor in
            for await msg in broadcasts {
                guard let payload = msg["payload"], let data = try? JSONEncoder().encode(payload),
                      let ev = SessionEvent.decode(data) else { continue }
                onEvent(ev)
            }
        })
        if let onPresence {
            let changes = ch.presenceChange()
            sc.tasks.append(Task { @MainActor [weak sc] in
                for await action in changes {
                    guard let sc else { return }
                    for key in action.leaves.keys { sc.presence[key] = nil }
                    for (key, p) in action.joins {
                        if let s = try? p.decodeState(as: PresenceState.self) { sc.presence[key] = s }
                    }
                    onPresence(Array(sc.presence.values).sorted { $0.displayName < $1.displayName })
                }
            })
        }
        try await ch.subscribeWithError()
        return sc
    }

    public func send(_ event: SessionEvent) async {
        guard let data = try? event.encoded(), let obj = try? JSONDecoder().decode(JSONObject.self, from: data) else { return }
        await channel.broadcast(event: SCProtocol.broadcastEvent, message: obj)
    }

    public func track(_ state: PresenceState) async { try? await channel.track(state) }

    public func close() async {
        tasks.forEach { $0.cancel() }
        tasks = []
        await backend.client.removeChannel(channel)
    }
}
