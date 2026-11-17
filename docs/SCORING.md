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
2. **Latency alignment:** choose the global offset `δ` (10 ms steps) that maximises the number of voiced frames within ±100 cents (octave-folded) of the active reference note. Apply `t ← t − δ`, and store it in the details.
   - **Latency unknown:** search `δ ∈ [−400, +400] ms`. This absorbs device and network latency, but it would also forgive a singer who is consistently late.
   - **Latency calibrated** (the phone measured it): search only ±80 ms around the measured value, so real lateness is still scored.
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
- **Transitions:** for consecutive notes with different pitch (gap < 150 ms), the singer's transition time is when their pitch crosses the midpoint between the two target pitches, *after having been on the first note's side*. Without that requirement, a late singer still on the note before would register an instant transition. Score with the same curve as onset, using tolerances of 80 ms and 300 ms.
- **Consistency:** `1 − min(1, σ(Δ_all) / 200 ms)`, which penalises erratic timing even when it averages out.
- **Rhythm = 0.7·mean(transition) + 0.3·consistency.**

## 4. Stability (15%)
On attempted notes ≥ 400 ms long:
1. Take the voiced pitch track in cents and subtract a 250 ms moving average (longer than any vibrato cycle). This removes intentional vibrato (4–8 Hz, which survives as a periodic residual) and slow drift is measured separately.
2. **Jitter** = std of the residual after removing a fitted sinusoid at 4–8 Hz (if vibrato is detected, its regularity counts as a bonus).
3. **Drift** = |slope| of the moving average across the note.
4. `stab = 1` at jitter ≤ 15 cents, falling linearly to `0` at 80 cents; minus `min(0.3, drift/200 cents per s)`.
5. **Stability** = duration-weighted mean.

## Overall
**Score = round(100 · Completion · (0.40·Pitch + 0.25·Timing + 0.20·Rhythm + 0.15·Stability))**

`Completion = 0.5 + 0.5·min(1, coverage / 0.9)`. Pitch, rhythm and stability only judge the notes the singer attempted, so without this factor a perfectly sung half-song would still score about 87. With it, that half-song scores about 68, and full credit starts at 90% coverage.

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

## Implementation
- **Code:** `packages/scoring` (TypeScript), version `1.0.0`.
- **Golden tests:** `packages/scoring/test/scoring.test.ts`. A deterministic simulated singer covers perfect, octave-down, transposed, semitone-flat, within-50-cents, unknown-latency, calibrated-late, half-skipped, wobbly vs vibrato, silence, and the noise gate.
- **Server copy:** the `score-performance` Edge Function uses a generated copy of the package (`npm run sync:scoring`). A test fails if the two ever differ.

## v1.1 (2026-11-17): six categories and a group score

| Category | Weight | What it measures |
|---|---|---|
| Pitch | 0.35 | Cents error per note, octave-folded per phrase, vibrato-tolerant (unchanged) |
| Timing | 0.20 | Note onsets within ±100 ms (full credit) to ±400 ms, plus coverage (unchanged) |
| Rhythm | 0.10 | **Steadiness** of your timing: the spread (std) of onset/transition offsets. A consistent small lag scores high here; timing still notes it |
| Duration | 0.10 | **New.** Of the notes you sang, how much of each you held (≥ 75% held = full credit) |
| Transitions | 0.10 | Moving to the next note at the right moment (the old "rhythm" transition measure) |
| Stability | 0.15 | Pitch steadiness on sustained notes, vibrato removed (unchanged) |

The overall score is `100 × completion × Σ weight × category`. Party songs with more than one singer also get a
**group score**: the average of the singers' scores (each person keeps their own result).

Onset detection fix: an onset is now the first frame within 50 cents of the note's target. Previously, the
tail of the previous note could count as an early onset, so a perfect performance with adjacent notes
scored 77 instead of 100. Performances store `scoring_version`, so v1.0 and v1.1 results can be told apart.
