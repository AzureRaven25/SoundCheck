'use client';
import { PROTOCOL_VERSION, type RtcEvent, type SessionEvent, type VoiceGainEvent } from '@soundcheck/contracts';

/**
 * Voice monitoring: each phone's (echo-cancelled) mic streams to the host screen over WebRTC so singers hear
 * themselves through the TV speakers. Opus audio peer-to-peer on the home network when possible; only the
 * offer/answer/ICE messages travel over the session's private Realtime channel. Typical latency on Wi-Fi is
 * ~100–200 ms: fine for hearing yourself in the mix, not a studio monitor.
 */
const RTC_CONFIG: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
type Send = (e: SessionEvent) => void;

const toCandidate = (c: RTCIceCandidate) => ({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex });

/** Phone side: offers its mic track to the host. */
export class VoiceSender {
  private pc: RTCPeerConnection | null = null;
  constructor(private memberId: string, private send: Send) {}

  async start(stream: MediaStream) {
    if (this.pc) return;
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    for (const t of stream.getAudioTracks()) pc.addTrack(t, stream);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.send({ type: 'rtc', v: PROTOCOL_VERSION, memberId: this.memberId, from: 'phone', candidate: toCandidate(ev.candidate) });
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this.send({ type: 'rtc', v: PROTOCOL_VERSION, memberId: this.memberId, from: 'phone', sdp: { type: 'offer', sdp: offer.sdp ?? '' } });
  }

  async handle(e: RtcEvent) {
    if (e.from !== 'host' || e.memberId !== this.memberId || !this.pc) return;
    if (e.sdp?.type === 'answer') await this.pc.setRemoteDescription(e.sdp);
    if (e.candidate) await this.pc.addIceCandidate(e.candidate).catch(() => { /* late candidate after close */ });
  }

  get state(): RTCPeerConnectionState | 'idle' { return this.pc?.connectionState ?? 'idle'; }
  stop() { this.pc?.close(); this.pc = null; }
}

interface Peer { pc: RTCPeerConnection; gain: GainNode; analyser: AnalyserNode; source?: MediaStreamAudioSourceNode; el?: HTMLAudioElement; own: number }

/** A short synthetic room (decaying noise), for the reverb half of the karaoke echo. */
function impulse(ctx: AudioContext, seconds = 1.4, decay = 3): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

/**
 * Host side: answers each phone and mixes its voice into the stage's AudioContext: one master volume, each
 * singer's own level (set from their phone), and the karaoke-box "echo" (a slap-back delay plus a little room).
 */
export class VoiceReceiver {
  private peers = new Map<string, Peer>();
  private volume = 0.8;
  private bus: GainNode;
  private wet: GainNode;
  private room: GainNode;
  constructor(private ctx: AudioContext, private send: Send) {
    this.bus = ctx.createGain();
    this.bus.connect(ctx.destination);
    // echo: 160 ms delay with feedback, darkened so repeats sit behind the dry voice
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.16;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 3200;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.bus.connect(delay);
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay);
    tone.connect(this.wet);
    this.wet.connect(ctx.destination);
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx);
    this.room = ctx.createGain();
    this.room.gain.value = 0;
    this.bus.connect(conv);
    conv.connect(this.room);
    this.room.connect(ctx.destination);
  }

  async handle(e: RtcEvent | VoiceGainEvent) {
    if (e.type === 'voice_gain') {
      const p = this.peers.get(e.memberId);
      const g = Math.max(0, Math.min(2, Number(e.gain) || 0));
      if (p) { p.own = g; p.gain.gain.setTargetAtTime(this.volume * g, this.ctx.currentTime, 0.05); }
      return;
    }
    if (e.from !== 'phone') return;
    if (e.sdp?.type === 'offer') {
      this.drop(e.memberId);
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const gain = this.ctx.createGain();
      gain.gain.value = this.volume;
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 1024;
      gain.connect(analyser);
      gain.connect(this.bus);
      const peer: Peer = { pc, gain, analyser, own: 1 };
      this.peers.set(e.memberId, peer);
      pc.ontrack = (ev) => {
        const stream = ev.streams[0] ?? new MediaStream([ev.track]);
        // Chrome only pulls remote WebRTC audio into Web Audio while a (muted) media element plays the stream
        const el = new Audio();
        el.muted = true;
        el.srcObject = stream;
        void el.play().catch(() => {});
        peer.el = el;
        peer.source = this.ctx.createMediaStreamSource(stream);
        peer.source.connect(gain);
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate) this.send({ type: 'rtc', v: PROTOCOL_VERSION, memberId: e.memberId, from: 'host', candidate: toCandidate(ev.candidate) });
      };
      await pc.setRemoteDescription(e.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.send({ type: 'rtc', v: PROTOCOL_VERSION, memberId: e.memberId, from: 'host', sdp: { type: 'answer', sdp: answer.sdp ?? '' } });
    } else if (e.candidate) {
      await this.peers.get(e.memberId)?.pc.addIceCandidate(e.candidate).catch(() => {});
    }
  }

  setVolume(v: number) {
    this.volume = v;
    for (const p of this.peers.values()) p.gain.gain.setTargetAtTime(v * p.own, this.ctx.currentTime, 0.05);
  }

  /** 0 = dry, 1 = full karaoke-box echo. */
  setEcho(amount: number) {
    const a = Math.max(0, Math.min(1, amount));
    this.wet.gain.setTargetAtTime(0.55 * a, this.ctx.currentTime, 0.05);
    this.room.gain.setTargetAtTime(0.35 * a, this.ctx.currentTime, 0.05);
  }

  /** Per-singer level (dBFS) and connection state, for the host's indicators and tests. */
  status(): Record<string, { state: RTCPeerConnectionState; levelDb: number; gain: number }> {
    const out: Record<string, { state: RTCPeerConnectionState; levelDb: number; gain: number }> = {};
    const buf = new Float32Array(1024);
    for (const [id, p] of this.peers) {
      p.analyser.getFloatTimeDomainData(buf);
      let e = 0;
      for (const x of buf) e += x * x;
      out[id] = { state: p.pc.connectionState, levelDb: 10 * Math.log10(e / buf.length + 1e-12), gain: p.own };
    }
    return out;
  }

  drop(memberId: string) {
    const p = this.peers.get(memberId);
    if (!p) return;
    p.pc.close(); p.source?.disconnect(); p.gain.disconnect(); p.el?.pause();
    this.peers.delete(memberId);
  }
  close() {
    for (const id of [...this.peers.keys()]) this.drop(id);
    this.bus.disconnect(); this.wet.disconnect(); this.room.disconnect();
  }
}
