'use client';
import { PROTOCOL_VERSION, type RtcEvent, type SessionEvent } from '@soundcheck/contracts';

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

interface Peer { pc: RTCPeerConnection; gain: GainNode; analyser: AnalyserNode; source?: MediaStreamAudioSourceNode; el?: HTMLAudioElement }

/** Host side: answers each phone and mixes its voice into the stage's AudioContext with one volume control. */
export class VoiceReceiver {
  private peers = new Map<string, Peer>();
  private volume = 0.8;
  constructor(private ctx: AudioContext, private send: Send) {}

  async handle(e: RtcEvent) {
    if (e.from !== 'phone') return;
    if (e.sdp?.type === 'offer') {
      this.drop(e.memberId);
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const gain = this.ctx.createGain();
      gain.gain.value = this.volume;
      const analyser = this.ctx.createAnalyser();
      analyser.fftSize = 1024;
      gain.connect(analyser);
      gain.connect(this.ctx.destination);
      const peer: Peer = { pc, gain, analyser };
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
    for (const p of this.peers.values()) p.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** Per-singer level (dBFS) and connection state, for the host's indicators and tests. */
  status(): Record<string, { state: RTCPeerConnectionState; levelDb: number }> {
    const out: Record<string, { state: RTCPeerConnectionState; levelDb: number }> = {};
    const buf = new Float32Array(1024);
    for (const [id, p] of this.peers) {
      p.analyser.getFloatTimeDomainData(buf);
      let e = 0;
      for (const x of buf) e += x * x;
      out[id] = { state: p.pc.connectionState, levelDb: 10 * Math.log10(e / buf.length + 1e-12) };
    }
    return out;
  }

  drop(memberId: string) {
    const p = this.peers.get(memberId);
    if (!p) return;
    p.pc.close(); p.source?.disconnect(); p.gain.disconnect(); p.el?.pause();
    this.peers.delete(memberId);
  }
  close() { for (const id of [...this.peers.keys()]) this.drop(id); }
}
