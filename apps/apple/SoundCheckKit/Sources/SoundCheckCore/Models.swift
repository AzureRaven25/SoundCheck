import Foundation

/// A track as shown in lists across the apps (row of `tracks` + album title + artwork).
public struct Track: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var title: String
    public var artistCredit: String
    public var albumId: String?
    public var albumTitle: String?
    public var durationMs: Int?
    public var releaseYear: Int?
    public var artworkUrl: String?

    enum CodingKeys: String, CodingKey {
        case id, title
        case artistCredit = "artist_credit", albumId = "album_id", albumTitle = "album_title"
        case durationMs = "duration_ms", releaseYear = "release_year", artworkUrl = "artwork_url"
    }
    public init(id: String, title: String, artistCredit: String, albumId: String? = nil, albumTitle: String? = nil,
                durationMs: Int? = nil, releaseYear: Int? = nil, artworkUrl: String? = nil) {
        self.id = id; self.title = title; self.artistCredit = artistCredit; self.albumId = albumId; self.albumTitle = albumTitle
        self.durationMs = durationMs; self.releaseYear = releaseYear; self.artworkUrl = artworkUrl
    }
    public var durationText: String {
        guard let ms = durationMs else { return "" }
        let s = ms / 1000
        return "\(s / 60):\(String(format: "%02d", s % 60))"
    }
}

public struct LyricWord: Codable, Hashable, Sendable { public var start: Double; public var end: Double; public var text: String
    public init(start: Double, end: Double, text: String) { self.start = start; self.end = end; self.text = text } }
public struct LyricLine: Codable, Hashable, Sendable {
    public var start: Double?; public var end: Double?; public var text: String; public var words: [LyricWord]?
    public init(start: Double?, end: Double? = nil, text: String, words: [LyricWord]? = nil) { self.start = start; self.end = end; self.text = text; self.words = words }
}
public struct RefNote: Codable, Hashable, Sendable { public var start: Double; public var end: Double; public var pitch: Double; public var conf: Double?
    public init(start: Double, end: Double, pitch: Double, conf: Double? = nil) { self.start = start; self.end = end; self.pitch = pitch; self.conf = conf } }
public struct VocalRange: Codable, Hashable, Sendable { public var low: Double; public var high: Double; public var min: Double; public var max: Double }

/// Everything SoundCheck Stage needs to run a song.
public struct StageData: Sendable {
    public var track: Track
    public var notes: [RefNote]
    public var musicalKey: String?
    public var vocalRange: VocalRange?
    public var lines: [LyricLine]
    public var wordTimed: Bool
    public var instrumentalURL: URL
    public var vocalsURL: URL
    public init(track: Track, notes: [RefNote], musicalKey: String?, vocalRange: VocalRange?, lines: [LyricLine], wordTimed: Bool, instrumentalURL: URL, vocalsURL: URL) {
        self.track = track; self.notes = notes; self.musicalKey = musicalKey; self.vocalRange = vocalRange
        self.lines = lines; self.wordTimed = wordTimed; self.instrumentalURL = instrumentalURL; self.vocalsURL = vocalsURL
    }
}
