export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      achievements: {
        Row: {
          description: string
          icon: string
          id: string
          sort_order: number
          tier: string
          title: string
        }
        Insert: {
          description: string
          icon: string
          id: string
          sort_order?: number
          tier?: string
          title: string
        }
        Update: {
          description?: string
          icon?: string
          id?: string
          sort_order?: number
          tier?: string
          title?: string
        }
        Relationships: []
      }
      album_artists: {
        Row: {
          album_id: string
          artist_id: string
          join_phrase: string
          position: number
        }
        Insert: {
          album_id: string
          artist_id: string
          join_phrase?: string
          position: number
        }
        Update: {
          album_id?: string
          artist_id?: string
          join_phrase?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "album_artists_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "album_artists_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      albums: {
        Row: {
          artist_credit: string
          created_at: string
          id: string
          mbid: string | null
          popularity: number
          primary_type: string
          release_date: string | null
          release_year: number | null
          search: unknown
          title: string
          updated_at: string
        }
        Insert: {
          artist_credit: string
          created_at?: string
          id?: string
          mbid?: string | null
          popularity?: number
          primary_type?: string
          release_date?: string | null
          release_year?: number | null
          search?: unknown
          title: string
          updated_at?: string
        }
        Update: {
          artist_credit?: string
          created_at?: string
          id?: string
          mbid?: string | null
          popularity?: number
          primary_type?: string
          release_date?: string | null
          release_year?: number | null
          search?: unknown
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      artists: {
        Row: {
          country: string | null
          created_at: string
          disambiguation: string | null
          id: string
          mbid: string | null
          name: string
          popularity: number
          search: unknown
          sort_name: string | null
          updated_at: string
        }
        Insert: {
          country?: string | null
          created_at?: string
          disambiguation?: string | null
          id?: string
          mbid?: string | null
          name: string
          popularity?: number
          search?: unknown
          sort_name?: string | null
          updated_at?: string
        }
        Update: {
          country?: string | null
          created_at?: string
          disambiguation?: string | null
          id?: string
          mbid?: string | null
          name?: string
          popularity?: number
          search?: unknown
          sort_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      artwork: {
        Row: {
          checked_at: string | null
          created_at: string
          entity_id: string
          entity_type: string
          height: number | null
          id: string
          is_primary: boolean
          phash: number | null
          provider: string
          source_url: string
          status: string
          storage_path: string | null
          width: number | null
        }
        Insert: {
          checked_at?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          height?: number | null
          id?: string
          is_primary?: boolean
          phash?: number | null
          provider: string
          source_url: string
          status?: string
          storage_path?: string | null
          width?: number | null
        }
        Update: {
          checked_at?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          height?: number | null
          id?: string
          is_primary?: boolean
          phash?: number | null
          provider?: string
          source_url?: string
          status?: string
          storage_path?: string | null
          width?: number | null
        }
        Relationships: []
      }
      audio_assets: {
        Row: {
          attribution_url: string | null
          bitrate_kbps: number | null
          created_at: string
          duration_ms: number | null
          external_url: string | null
          fingerprint: string | null
          id: string
          kind: string
          mime_type: string | null
          owner_id: string | null
          provider: string
          source_asset_id: string | null
          storage_path: string | null
          track_id: string
        }
        Insert: {
          attribution_url?: string | null
          bitrate_kbps?: number | null
          created_at?: string
          duration_ms?: number | null
          external_url?: string | null
          fingerprint?: string | null
          id?: string
          kind: string
          mime_type?: string | null
          owner_id?: string | null
          provider: string
          source_asset_id?: string | null
          storage_path?: string | null
          track_id: string
        }
        Update: {
          attribution_url?: string | null
          bitrate_kbps?: number | null
          created_at?: string
          duration_ms?: number | null
          external_url?: string | null
          fingerprint?: string | null
          id?: string
          kind?: string
          mime_type?: string | null
          owner_id?: string | null
          provider?: string
          source_asset_id?: string | null
          storage_path?: string | null
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audio_assets_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: false
            referencedRelation: "audio_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_assets_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          track_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          track_id: string
          user_id?: string
        }
        Update: {
          created_at?: string
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          accepted_at: string | null
          created_at: string
          friend_id: string
          status: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          friend_id: string
          status?: string
          user_id?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          friend_id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      karaoke_analysis: {
        Row: {
          contour_path: string | null
          created_at: string
          id: string
          musical_key: string | null
          notes: Json
          phrases: Json
          pipeline_version: string
          pitch_model: string
          separation_model: string
          source_asset_id: string
          tempo_bpm: number | null
          track_id: string
          vocal_range: Json | null
          word_lyrics: Json | null
        }
        Insert: {
          contour_path?: string | null
          created_at?: string
          id?: string
          musical_key?: string | null
          notes: Json
          phrases?: Json
          pipeline_version: string
          pitch_model: string
          separation_model: string
          source_asset_id: string
          tempo_bpm?: number | null
          track_id: string
          vocal_range?: Json | null
          word_lyrics?: Json | null
        }
        Update: {
          contour_path?: string | null
          created_at?: string
          id?: string
          musical_key?: string | null
          notes?: Json
          phrases?: Json
          pipeline_version?: string
          pitch_model?: string
          separation_model?: string
          source_asset_id?: string
          tempo_bpm?: number | null
          track_id?: string
          vocal_range?: Json | null
          word_lyrics?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "karaoke_analysis_source_asset_id_fkey"
            columns: ["source_asset_id"]
            isOneToOne: true
            referencedRelation: "audio_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "karaoke_analysis_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      karaoke_sessions: {
        Row: {
          created_at: string
          current_track_id: string | null
          ended_at: string | null
          expires_at: string
          host_id: string
          host_platform: string
          id: string
          max_members: number
          pairing_code: string
          settings: Json
          status: string
        }
        Insert: {
          created_at?: string
          current_track_id?: string | null
          ended_at?: string | null
          expires_at?: string
          host_id?: string
          host_platform: string
          id?: string
          max_members?: number
          pairing_code: string
          settings?: Json
          status?: string
        }
        Update: {
          created_at?: string
          current_track_id?: string | null
          ended_at?: string | null
          expires_at?: string
          host_id?: string
          host_platform?: string
          id?: string
          max_members?: number
          pairing_code?: string
          settings?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "karaoke_sessions_current_track_id_fkey"
            columns: ["current_track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      listening_history: {
        Row: {
          id: number
          mode: string
          ms_played: number
          platform: string
          played_at: string
          track_id: string
          user_id: string
        }
        Insert: {
          id?: never
          mode?: string
          ms_played?: number
          platform: string
          played_at?: string
          track_id: string
          user_id?: string
        }
        Update: {
          id?: never
          mode?: string
          ms_played?: number
          platform?: string
          played_at?: string
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listening_history_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      lyrics: {
        Row: {
          content: Json
          fetched_at: string
          granularity: string
          id: string
          is_primary: boolean
          language: string | null
          provider: string
          provider_ref: string | null
          track_id: string
        }
        Insert: {
          content: Json
          fetched_at?: string
          granularity: string
          id?: string
          is_primary?: boolean
          language?: string | null
          provider: string
          provider_ref?: string | null
          track_id: string
        }
        Update: {
          content?: Json
          fetched_at?: string
          granularity?: string
          id?: string
          is_primary?: boolean
          language?: string | null
          provider?: string
          provider_ref?: string | null
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lyrics_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      performances: {
        Row: {
          created_at: string
          details: Json
          duration_ms: number | null
          grade: string
          id: string
          key_shift: number
          member_id: string | null
          pitch_score: number
          rhythm_score: number
          score: number
          scoring_version: string
          session_id: string | null
          stability_score: number
          timing_score: number
          track_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: Json
          duration_ms?: number | null
          grade: string
          id?: string
          key_shift?: number
          member_id?: string | null
          pitch_score: number
          rhythm_score: number
          score: number
          scoring_version: string
          session_id?: string | null
          stability_score: number
          timing_score: number
          track_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          details?: Json
          duration_ms?: number | null
          grade?: string
          id?: string
          key_shift?: number
          member_id?: string | null
          pitch_score?: number
          rhythm_score?: number
          score?: number
          scoring_version?: string
          session_id?: string | null
          stability_score?: number
          timing_score?: number
          track_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "performances_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "session_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performances_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "karaoke_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "performances_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      playlist_tracks: {
        Row: {
          added_at: string
          id: number
          playlist_id: string
          position: number
          track_id: string
        }
        Insert: {
          added_at?: string
          id?: never
          playlist_id: string
          position: number
          track_id: string
        }
        Update: {
          added_at?: string
          id?: never
          playlist_id?: string
          position?: number
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "playlist_tracks_playlist_id_fkey"
            columns: ["playlist_id"]
            isOneToOne: false
            referencedRelation: "playlists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "playlist_tracks_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      playlists: {
        Row: {
          cover_url: string | null
          created_at: string
          description: string | null
          id: string
          is_public: boolean
          owner_id: string
          title: string
          updated_at: string
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          owner_id?: string
          title: string
          updated_at?: string
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_public?: boolean
          owner_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      processing_jobs: {
        Row: {
          asset_id: string
          attempts: number
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          progress: number
          queue_msg_id: number | null
          requested_by: string | null
          stage: string | null
          started_at: string | null
          status: string
          track_id: string
          worker: string | null
        }
        Insert: {
          asset_id: string
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          progress?: number
          queue_msg_id?: number | null
          requested_by?: string | null
          stage?: string | null
          started_at?: string | null
          status?: string
          track_id: string
          worker?: string | null
        }
        Update: {
          asset_id?: string
          attempts?: number
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          progress?: number
          queue_msg_id?: number | null
          requested_by?: string | null
          stage?: string | null
          started_at?: string | null
          status?: string
          track_id?: string
          worker?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "processing_jobs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "audio_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "processing_jobs_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          display_name: string
          id: string
          is_guest: boolean
          show_on_leaderboards: boolean
          updated_at: string
          username: string | null
          vocal_high: number | null
          vocal_low: number | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name: string
          id: string
          is_guest?: boolean
          show_on_leaderboards?: boolean
          updated_at?: string
          username?: string | null
          vocal_high?: number | null
          vocal_low?: number | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_guest?: boolean
          show_on_leaderboards?: boolean
          updated_at?: string
          username?: string | null
          vocal_high?: number | null
          vocal_low?: number | null
        }
        Relationships: []
      }
      search_history: {
        Row: {
          created_at: string
          id: number
          query: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          query: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: never
          query?: string
          user_id?: string
        }
        Relationships: []
      }
      session_members: {
        Row: {
          color: string
          device_platform: string | null
          display_name: string
          id: string
          joined_at: string
          kicked: boolean
          left_at: string | null
          mic_volume: number
          role: string
          session_id: string
          user_id: string
        }
        Insert: {
          color?: string
          device_platform?: string | null
          display_name: string
          id?: string
          joined_at?: string
          kicked?: boolean
          left_at?: string | null
          mic_volume?: number
          role?: string
          session_id: string
          user_id: string
        }
        Update: {
          color?: string
          device_platform?: string | null
          display_name?: string
          id?: string
          joined_at?: string
          kicked?: boolean
          left_at?: string | null
          mic_volume?: number
          role?: string
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_members_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "karaoke_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_queue: {
        Row: {
          created_at: string
          id: string
          key_shift: number
          position: number
          requested_by: string
          session_id: string
          singer_member_ids: string[]
          status: string
          track_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_shift?: number
          position: number
          requested_by?: string
          session_id: string
          singer_member_ids?: string[]
          status?: string
          track_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_shift?: number
          position?: number
          requested_by?: string
          session_id?: string
          singer_member_ids?: string[]
          status?: string
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_queue_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "karaoke_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_queue_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      track_artists: {
        Row: {
          artist_id: string
          join_phrase: string
          position: number
          track_id: string
        }
        Insert: {
          artist_id: string
          join_phrase?: string
          position: number
          track_id: string
        }
        Update: {
          artist_id?: string
          join_phrase?: string
          position?: number
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "track_artists_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "track_artists_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      track_recordings: {
        Row: {
          recording_mbid: string
          track_id: string
        }
        Insert: {
          recording_mbid: string
          track_id: string
        }
        Update: {
          recording_mbid?: string
          track_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "track_recordings_track_id_fkey"
            columns: ["track_id"]
            isOneToOne: false
            referencedRelation: "tracks"
            referencedColumns: ["id"]
          },
        ]
      }
      tracks: {
        Row: {
          album_id: string | null
          artist_credit: string
          created_at: string
          duration_ms: number | null
          id: string
          isrcs: string[]
          mbid: string | null
          norm_artist: string | null
          norm_title: string | null
          popularity: number
          release_year: number | null
          search: unknown
          title: string
          updated_at: string
        }
        Insert: {
          album_id?: string | null
          artist_credit: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          isrcs?: string[]
          mbid?: string | null
          norm_artist?: string | null
          norm_title?: string | null
          popularity?: number
          release_year?: number | null
          search?: unknown
          title: string
          updated_at?: string
        }
        Update: {
          album_id?: string | null
          artist_credit?: string
          created_at?: string
          duration_ms?: number | null
          id?: string
          isrcs?: string[]
          mbid?: string | null
          norm_artist?: string | null
          norm_title?: string | null
          popularity?: number
          release_year?: number | null
          search?: unknown
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracks_album_id_fkey"
            columns: ["album_id"]
            isOneToOne: false
            referencedRelation: "albums"
            referencedColumns: ["id"]
          },
        ]
      }
      user_achievements: {
        Row: {
          achievement_id: string
          earned_at: string
          performance_id: string | null
          user_id: string
        }
        Insert: {
          achievement_id: string
          earned_at?: string
          performance_id?: string | null
          user_id: string
        }
        Update: {
          achievement_id?: string
          earned_at?: string
          performance_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_achievements_performance_id_fkey"
            columns: ["performance_id"]
            isOneToOne: false
            referencedRelation: "performances"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          prefs: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          prefs?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          prefs?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_session: {
        Args: { p_display_name?: string; p_platform: string }
        Returns: {
          expires_at: string
          pairing_code: string
          session_id: string
        }[]
      }
      global_leaderboard: {
        Args: { p_limit?: number; p_scope?: string }
        Returns: {
          avatar_url: string
          avg_best: number
          display_name: string
          rank: number
          tracks_sung: number
          user_id: string
        }[]
      }
      join_session: {
        Args: { p_code: string; p_display_name: string; p_platform: string }
        Returns: {
          color: string
          host_platform: string
          member_id: string
          session_id: string
        }[]
      }
      my_stats: {
        Args: never
        Returns: {
          achievements: number
          avg_pitch: number
          avg_rhythm: number
          avg_score: number
          avg_stability: number
          avg_timing: number
          best_score: number
          performances: number
          tracks_sung: number
        }[]
      }
      provider_cache_get: {
        Args: { p_key: string; p_provider: string }
        Returns: {
          status: string
          value: Json
        }[]
      }
      provider_cache_put: {
        Args: {
          p_key: string
          p_provider: string
          p_status: string
          p_ttl_seconds: number
          p_value: Json
        }
        Returns: undefined
      }
      provider_reserve_slot: {
        Args: { p_max_wait_ms?: number; p_provider: string }
        Returns: number
      }
      request_processing: {
        Args: { p_asset_id: string }
        Returns: {
          analysis_id: string
          job_id: string
          status: string
        }[]
      }
      search_tracks: {
        Args: { lim?: number; off?: number; q: string }
        Returns: {
          album_id: string
          album_title: string
          artist_credit: string
          artwork_url: string
          duration_ms: number
          id: string
          popularity: number
          rank: number
          release_year: number
          title: string
        }[]
      }
      track_leaderboard: {
        Args: { p_limit?: number; p_scope?: string; p_track_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          grade: string
          key_shift: number
          performed_at: string
          rank: number
          score: number
          user_id: string
        }[]
      }
      worker_claim_jobs: {
        Args: {
          p_qty?: number
          p_visibility_seconds?: number
          p_worker: string
        }
        Returns: {
          job: Json
          msg_id: number
          read_ct: number
        }[]
      }
      worker_finish_job: {
        Args: {
          p_error?: string
          p_job_id: string
          p_msg_id: number
          p_ok: boolean
        }
        Returns: undefined
      }
      worker_update_job: {
        Args: { p_job_id: string; p_progress: number; p_stage: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
