import Foundation
import Supabase
@_exported import SoundCheckCore

/// Client configuration. Only the *publishable* key ever ships in an app; the secret key stays server-side.
public struct SoundCheckConfig: Sendable {
    public let url: URL
    public let publishableKey: String
    public let siteURL: URL

    /// Reads `SoundCheckSupabaseURL`, `SoundCheckSupabaseKey` and `SoundCheckSiteURL` from Info.plist
    /// (set per build configuration in the app's xcconfig).
    public static func fromBundle(_ bundle: Bundle = .main) -> SoundCheckConfig {
        func value(_ k: String) -> String { (bundle.object(forInfoDictionaryKey: k) as? String) ?? "" }
        return SoundCheckConfig(
            url: URL(string: value("SoundCheckSupabaseURL")) ?? URL(string: "http://127.0.0.1:54321")!,
            publishableKey: value("SoundCheckSupabaseKey"),
            siteURL: URL(string: value("SoundCheckSiteURL")) ?? URL(string: "http://localhost:3000")!)
    }
    public init(url: URL, publishableKey: String, siteURL: URL) { self.url = url; self.publishableKey = publishableKey; self.siteURL = siteURL }
}

public enum StageLoad: Sendable {
    case ready(StageData)
    case notReady(title: String)
    case signedOut
}

public struct SessionInfo: Sendable, Equatable { public let id: String; public let code: String }
public struct JoinInfo: Sendable, Equatable { public let sessionId: String; public let memberId: String; public let color: String }

public struct ScoreSinger: Encodable, Sendable {
    public let member_id: String?
    public let frames: [Double]
    public let latency_ms: Double?
    public let noise_floor_db: Double?
    public init(memberId: String?, frames: [Double], latencyMs: Double?, noiseFloorDb: Double?) {
        member_id = memberId; self.frames = frames; latency_ms = latencyMs; noise_floor_db = noiseFloorDb
    }
}

/// One Supabase client per app, plus typed helpers for every backend call the Apple apps make.
/// Business rules live in Postgres (RLS + RPCs) and Edge Functions, exactly as for the web.
public final class SoundCheckBackend: Sendable {
    public let client: SupabaseClient
    public let config: SoundCheckConfig

    public init(config: SoundCheckConfig = .fromBundle()) {
        self.config = config
        client = SupabaseClient(supabaseURL: config.url, supabaseKey: config.publishableKey)
    }

    // MARK: Auth
    public var currentUser: User? { client.auth.currentUser }
    public func signIn(email: String, password: String) async throws { _ = try await client.auth.signIn(email: email, password: password) }
    public func signUp(email: String, password: String, displayName: String) async throws {
        _ = try await client.auth.signUp(email: email, password: password, data: ["display_name": .string(displayName)])
    }
    /// Phones that join a party without an account become anonymous users (real auth.uid() for RLS).
    public func ensureSignedIn(displayName: String) async throws {
        if client.auth.currentUser == nil {
            _ = try await client.auth.signInAnonymously(data: ["display_name": .string(displayName)])
        }
    }
    public func signOut() async throws { try await client.auth.signOut() }
    public var displayName: String {
        if case let .string(n)? = currentUser?.userMetadata["display_name"] { return n }
        return currentUser?.email?.components(separatedBy: "@").first ?? "Host"
    }

    // MARK: Catalog
    private struct Row: Decodable { let id: String; let title: String; let artist_credit: String; let album_id: String?; let duration_ms: Int?; let release_year: Int?
        let albums: Album?; struct Album: Decodable { let title: String } }
    private struct Art: Decodable { let entity_id: String; let source_url: String; let storage_path: String? }

    private func withArtwork(_ rows: [Row]) async throws -> [Track] {
        let ids = Array(Set(rows.compactMap(\.album_id)))
        var art: [String: String] = [:]
        if !ids.isEmpty {
            let a: [Art] = try await client.from("artwork").select("entity_id, source_url, storage_path")
                .eq("entity_type", value: "album").eq("is_primary", value: true).in("entity_id", values: ids).execute().value
            for x in a { art[x.entity_id] = x.storage_path ?? x.source_url }
        }
        return rows.map { r in
            Track(id: r.id, title: r.title, artistCredit: r.artist_credit, albumId: r.album_id, albumTitle: r.albums?.title,
                  durationMs: r.duration_ms, releaseYear: r.release_year, artworkUrl: r.album_id.flatMap { art[$0] })
        }
    }

    public func popular(limit: Int = 30, offset: Int = 0) async throws -> [Track] {
        let rows: [Row] = try await client.from("tracks")
            .select("id, title, artist_credit, album_id, duration_ms, release_year, albums(title)")
            .order("popularity", ascending: false).range(from: offset, to: offset + limit - 1).execute().value
        return try await withArtwork(rows)
    }

    /// Tiered search (Supabase → Turso → MusicBrainz live) through the catalog-search Edge Function.
    public func search(_ q: String, limit: Int = 30) async throws -> [Track] {
        struct Body: Encodable { let q: String; let limit: Int }
        struct Res: Decodable { let results: [Track] }
        let res: Res = try await client.functions.invoke("catalog-search", options: .init(body: Body(q: q, limit: limit)))
        return res.results
    }

    /// Fills in missing album artwork (Cover Art Archive → iTunes) via resolve-artwork.
    public func resolveArtwork(albumId: String) async -> String? {
        struct Body: Encodable { let album_id: String }
        struct Res: Decodable { let url: String? }
        let r: Res? = try? await client.functions.invoke("resolve-artwork", options: .init(body: Body(album_id: albumId)))
        return r?.url
    }

    /// Songs with SoundCheck Stage assets this user can open (newest first).
    public func karaokeReady(limit: Int = 30) async throws -> [Track] {
        struct A: Decodable { let track_id: String }
        let a: [A] = try await client.from("karaoke_analysis").select("track_id").order("created_at", ascending: false).limit(limit).execute().value
        var seen = Set<String>(); let ids = a.map(\.track_id).filter { seen.insert($0).inserted }
        guard !ids.isEmpty else { return [] }
        let rows: [Row] = try await client.from("tracks").select("id, title, artist_credit, album_id, duration_ms, release_year, albums(title)")
            .in("id", values: ids).execute().value
        let byId = Dictionary(uniqueKeysWithValues: try await withArtwork(rows).map { ($0.id, $0) })
        return ids.compactMap { byId[$0] }
    }

    /// Whether SoundCheck Stage assets exist for a track (any processed analysis).
    public func isKaraokeReady(trackId: String) async -> Bool {
        struct A: Decodable { let id: String }
        let a: [A]? = try? await client.from("karaoke_analysis").select("id").eq("track_id", value: trackId).limit(1).execute().value
        return !(a ?? []).isEmpty
    }

    /// 30 s preview for browsing (resolve-preview), with the store link to credit.
    public func preview(trackId: String) async -> (url: URL, attribution: URL?)? {
        struct Body: Encodable { let track_id: String }
        struct Res: Decodable { let url: String?; let attribution_url: String? }
        guard let r: Res = try? await client.functions.invoke("resolve-preview", options: .init(body: Body(track_id: trackId))),
              let u = r.url.flatMap(URL.init(string:)) else { return nil }
        return (u, r.attribution_url.flatMap(URL.init(string:)))
    }

    // MARK: Stage
    /// Everything SoundCheck Stage needs for a track (mirror of apps/web/src/stage/useStageData.ts).
    public func stageData(trackId: String) async throws -> StageLoad {
        struct T: Decodable { let id: String; let title: String; let artist_credit: String; let album_id: String? }
        struct WordLyrics: Decodable { let lines: [LyricLine] }
        struct An: Decodable { let id: String; let source_asset_id: String; let notes: [RefNote]; let musical_key: String?; let vocal_range: VocalRange?; let word_lyrics: WordLyrics? }
        struct Stem: Decodable { let kind: String; let storage_path: String? }
        struct LyricsRes: Decodable { let granularity: String?; let lines: [LyricLine]? }
        struct LBody: Encodable { let track_id: String }

        let tracks: [T] = try await client.from("tracks").select("id, title, artist_credit, album_id").eq("id", value: trackId).limit(1).execute().value
        guard let t = tracks.first else { throw URLError(.fileDoesNotExist) }
        guard currentUser != nil else { return .signedOut }
        let an: [An] = try await client.from("karaoke_analysis").select("id, source_asset_id, notes, musical_key, vocal_range, word_lyrics")
            .eq("track_id", value: trackId).order("created_at", ascending: false).limit(1).execute().value
        guard let a = an.first else { return .notReady(title: t.title) }
        async let stemsQ: [Stem] = client.from("audio_assets").select("kind, storage_path").eq("source_asset_id", value: a.source_asset_id)
            .in("kind", values: ["instrumental", "vocals"]).execute().value
        async let lyricsQ: LyricsRes? = try? client.functions.invoke("fetch-lyrics", options: .init(body: LBody(track_id: trackId)))
        let stems = try await stemsQ, lyrics = await lyricsQ
        guard let ip = stems.first(where: { $0.kind == "instrumental" })?.storage_path,
              let vp = stems.first(where: { $0.kind == "vocals" })?.storage_path else { return .notReady(title: t.title) }
        let bucket = client.storage.from("audio")
        async let iu = bucket.createSignedURL(path: ip, expiresIn: 3 * 3600)
        async let vu = bucket.createSignedURL(path: vp, expiresIn: 3 * 3600)
        let art = try await withArtwork([Row(id: t.id, title: t.title, artist_credit: t.artist_credit, album_id: t.album_id, duration_ms: nil, release_year: nil, albums: nil)])
        let lines = (a.word_lyrics?.lines ?? lyrics?.lines ?? []).filter { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty && $0.start != nil }
        return .ready(StageData(track: art[0], notes: a.notes, musicalKey: a.musical_key, vocalRange: a.vocal_range, lines: lines,
                                wordTimed: a.word_lyrics != nil || lyrics?.granularity == "word",
                                instrumentalURL: try await iu, vocalsURL: try await vu))
    }

    public func lyrics(trackId: String) async -> [LyricLine] {
        struct LBody: Encodable { let track_id: String }
        struct LyricsRes: Decodable { let lines: [LyricLine]? }
        let r: LyricsRes? = try? await client.functions.invoke("fetch-lyrics", options: .init(body: LBody(track_id: trackId)))
        return (r?.lines ?? []).filter { $0.start != nil && !$0.text.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    /// Official SoundCheck Score (score-performance Edge Function); one result per singer.
    public func score(trackId: String, sessionId: String?, keyShift: Int, singers: [ScoreSinger]) async throws -> [ScoredSinger] {
        struct Body: Encodable { let track_id: String; let session_id: String?; let key_shift: Int; let singers: [ScoreSinger] }
        struct Res: Decodable { let results: [ScoredSinger] }
        let r: Res = try await client.functions.invoke("score-performance", options: .init(body: Body(track_id: trackId, session_id: sessionId, key_shift: keyShift, singers: singers)))
        return r.results
    }

    // MARK: Sessions
    public func createSession(platform: Platform, trackId: String?) async throws -> SessionInfo {
        struct P: Encodable { let p_platform: String; let p_display_name: String }
        struct R: Decodable { let session_id: String; let pairing_code: String }
        let r: [R] = try await client.rpc("create_session", params: P(p_platform: platform.rawValue, p_display_name: displayName)).execute().value
        guard let s = r.first else { throw URLError(.badServerResponse) }
        struct U: Encodable { let status: String; let current_track_id: String? }
        try await client.from("karaoke_sessions").update(U(status: "active", current_track_id: trackId)).eq("id", value: s.session_id).execute()
        return SessionInfo(id: s.session_id, code: s.pairing_code)
    }

    public func joinSession(code: String, displayName: String, platform: Platform) async throws -> JoinInfo {
        struct P: Encodable { let p_code: String; let p_display_name: String; let p_platform: String }
        struct R: Decodable { let session_id: String; let member_id: String; let color: String }
        let r: [R] = try await client.rpc("join_session", params: P(p_code: code, p_display_name: displayName, p_platform: platform.rawValue)).execute().value
        guard let j = r.first else { throw URLError(.badServerResponse) }
        return JoinInfo(sessionId: j.session_id, memberId: j.member_id, color: j.color)
    }

    public func joinURL(code: String) -> URL { config.siteURL.appendingPathComponent("join").appendingPathComponent(code) }
}

/// One singer's official result as returned by score-performance.
public struct ScoredSinger: Decodable, Sendable, Identifiable {
    public let member_id: String?
    public let performance_id: String?
    public let score: Int
    public let grade: Grade
    public let pitch: Double, timing: Double, rhythm: Double, stability: Double
    public let feedback: [String]
    public var id: String { member_id ?? "solo" }
    public var asResult: PerformanceResult {
        PerformanceResult(memberId: member_id ?? "", performanceId: performance_id, score: score, grade: grade,
                          pitch: pitch, timing: timing, rhythm: rhythm, stability: stability, feedback: feedback)
    }
}
