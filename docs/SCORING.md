# SoundCheck Score: methodology (v1)

Goal: scores that are **fair across voices** (any octave, any key), **consistent** (the same performance gives the same score), and **explainable** (every point traces back to a measurable deviation).

## Inputs
- **Reference** (from the pipeline, per track):
  - `notes[{start,end,pitch(MIDI),conf}]` from the isolated vocal;
  - `phrases[{start,end,noteIdx[]}]` from lyric lines, or from gaps of at least 300 ms in the melody.
- **Performance** (from the phone, per singer): frames at 100 Hz, `{t (song time, s), f0 (Hz|0), conf (0–1), rms (dBFS)}`.
- **Session parameters:** `keyShift` (semitones), which applies `pitch + keyShift` to every reference note.

## 0. Preparation
1. **Voicing gate:** a frame is *voiced* if `f0 > 0`, `conf ≥ 0.6` and `rms ≥ noiseFloor + 10 dB` (the floor comes from calibration).
2. **Latency alignment:** choose the global offset `δ ∈ [−400 ms, +400 ms]` (10 ms steps) that maximises the number of voiced frames within ±100 cents (octave-folded) of the active reference note. Apply `t ← t − δ`. This absorbs device and network latency automatically, and it's stored in the details.
3. **Octave choice per phrase:** for each phrase, pick the octave offset `o ∈ {−24, −12, 0, +12, +24}` semitones that minimises the median absolute cents error. A baritone singing a soprano line an octave down loses nothing. The choice is reported.
4. **Excluded material:**
   - Reference notes with `conf < 0.5` (unreliable detection, e.g. spoken or breathy sections) get weight 0.5.
   - Lines with no reference notes (spoken interludes) don't count.

## 1. Pitch accuracy (weight 40%)
For each voiced frame inside a reference note, `e = |cents(f0) − 100·(pitch + keyShift + o)|`, then
`s(e) = 1` if `e ≤ 50`; `1 − (e − 50)/250` if `50 < e < 300`; `0` otherwise.
- Note pitch score = mean `s` over its voiced frames.
- **Pitch = Σ(noteScore · duration · weight) / Σ(duration · weight)** over notes the singer attempted, meaning at least 25% of the note's frames are voiced. Notes not attempted are counted by Timing (coverage), not here, so a quiet-but-accurate singer isn't double-penalised.

## 2. Timing (25%)
- **Onset:** for each phrase-initial note and each note after a gap of ≥ 150 ms, `Δ` is the first voiced frame within ±400 ms minus the note start.
  `onset(Δ) = 1` if `|Δ| ≤ 100 ms`, linear down to `0` at `400 ms`, and `0` if no voice is found.
- **Coverage:** the fraction of reference note time covered by voiced frames (capped per note at 1).
- **Timing = 0.5·mean(onset) + 0.5·coverage.**
- Also reported: a mean `Δ` ("you tend to come in 120 ms late").

## 3. Rhythm (20%)
- **Transitions:** for consecutive notes with different pitch (gap < 150 ms), the singer's transition time is when their pitch crosses the midpoint between the two target pitches. Score with the same curve as onset, using tolerances of 80 ms and 300 ms.
- **Consistency:** `1 − min(1, σ(Δ_all) / 200 ms)`, which penalises erratic timing even when it averages out.
- **Rhythm = 0.7·mean(transition) + 0.3·consistency.**

## 4. Stability (15%)
On attempted notes ≥ 400 ms long:
1. Take the voiced pitch track in cents and subtract a 150 ms moving average. This removes intentional vibrato (4–8 Hz, which survives as a periodic residual) and slow drift is measured separately.
2. **Jitter** = std of the residual after removing a fitted sinusoid at 4–8 Hz (if vibrato is detected, its regularity counts as a bonus).
3. **Drift** = |slope| of the moving average across the note.
4. `stab = 1` at jitter ≤ 15 cents, falling linearly to `0` at 80 cents; minus `min(0.3, drift/200 cents per s)`.
5. **Stability** = duration-weighted mean.

## Overall
**Score = round(100 · (0.40·Pitch + 0.25·Timing + 0.20·Rhythm + 0.15·Stability))**

| Grade | Score |
|---|---|
| S | ≥ 95 |
| A | ≥ 85 |
| B | ≥ 70 |
| C | ≥ 55 |
| D | < 55 |

**Feedback:** the engine emits up to 3 messages, chosen from the weakest category and the worst phrases. Examples:
- "Chorus 2 was 40 cents flat on average"
- "You came in late on 6 phrases (avg +180 ms)"
- "Great sustain on the long notes"

## Multiple singers, harmonies, duets
- Each singer is scored independently against the reference (the duet part assignment is optional per line).
- A singer harmonising a third above scores low on pitch. v2 adds a **harmony mode** that accepts diatonic thirds/fifths of the reference for designated lines.
- **Group score** = mean of singer scores, weighted by each singer's covered duration.

## Live HUD vs final score
- Phones and TVs show live hit/miss feedback with a cheap per-frame check (±100 cents, octave-folded).
- The **official score** is computed once by the `score-performance` Edge Function, using `@soundcheck/scoring` (the same code the web app runs), so every platform agrees.

## Versioning
Every performance stores `scoring_version`. Golden fixtures in `packages/contracts/fixtures/scoring/` pin expected scores for synthetic performances:
- perfect;
- an octave down;
- 30 cents flat;
- 200 ms late;
- missing phrases;
- wobbly.
Any change to the weights or curves must update the fixtures intentionally.
