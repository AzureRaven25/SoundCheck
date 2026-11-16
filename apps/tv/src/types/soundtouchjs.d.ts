declare module 'soundtouchjs' {
  export interface SampleSource {
    extract(target: Float32Array, numFrames: number, position: number): number;
  }
  export class SoundTouch {
    pitchSemitones: number;
    tempo: number;
    rate: number;
    clear(): void;
  }
  export class SimpleFilter {
    constructor(source: SampleSource, pipe: SoundTouch, onEnd?: () => void);
    sourcePosition: number;
    readonly position: number;
    extract(target: Float32Array, numFrames: number): number;
    clear(): void;
  }
  export function getWebAudioNode(
    context: AudioContext,
    filter: SimpleFilter,
    sourcePositionCallback?: (sourcePosition: number) => void,
    bufferSize?: number,
  ): ScriptProcessorNode;
}
