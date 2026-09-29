// ============================================================
// 轻松惬意的背景音乐（Web Audio 合成，无需音频文件）
// 暖色调 lo-fi：柔和和弦铺底 + 八音盒旋律 + 低音 + 黑胶底噪
// ============================================================

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// F 大调温暖和弦进行：Fmaj9 → Dm9 → Bbmaj7 → C9（每和弦 4 拍）
const BPM = 70;
const BEAT = 60 / BPM;
const CHORDS = [
  { bass: 41, pad: [53, 57, 60, 64, 67] }, // Fmaj9
  { bass: 38, pad: [50, 53, 57, 60, 64] }, // Dm9
  { bass: 46, pad: [50, 53, 57, 60] },     // Bbmaj7
  { bass: 48, pad: [52, 55, 58, 62] },     // C9
];

// 16 步旋律（F 大调五声音阶，跨 4 个和弦）
const MELODY = [
  77, null, 79, null, 81, null, 79, 77,
  74, null, 77, 74, 72, null, 74, null,
  77, 79, 81, null, 74, null, 72, null,
  79, null, 77, null, 74, 72, 69, null,
];

export class Music {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.started = false;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.master = null;
    this.delaySend = null;
  }

  ensureContext() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.ctx.destination);

    // 柔和的反馈延迟，制造空间感
    this.delaySend = this.ctx.createGain();
    this.delaySend.gain.value = 0.28;
    const delay = this.ctx.createDelay(1.5);
    delay.delayTime.value = BEAT * 3;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.32;
    const damp = this.ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2400;
    this.delaySend.connect(delay);
    delay.connect(damp);
    damp.connect(fb);
    fb.connect(delay);
    damp.connect(this.master);

    // 黑胶底噪
    this._makeCrackle();
  }

  _makeCrackle() {
    const dur = 2;
    const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      d[i] = last * 0.6 * (Math.random() < 0.012 ? (Math.random() * 2 - 1) : 1);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0.05;
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 400;
    src.connect(hp);
    hp.connect(g);
    g.connect(this.master);
    src.start();
  }

  pad(note, time, dur) {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = midiToFreq(note);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.055, time + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g);
    g.connect(this.master);
    g.connect(this.delaySend);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  bass(note, time) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToFreq(note);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.16, time + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, time + BEAT * 3.6);
    osc.connect(g);
    g.connect(this.master);
    osc.start(time);
    osc.stop(time + BEAT * 3.7);
  }

  musicBox(note, time) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = midiToFreq(note);
    const partial = this.ctx.createOscillator();
    partial.type = 'sine';
    partial.frequency.value = midiToFreq(note) * 2;
    const pg = this.ctx.createGain();
    pg.gain.value = 0.25;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.12, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 1.6);

    osc.connect(g);
    partial.connect(pg);
    pg.connect(g);
    g.connect(this.master);
    g.connect(this.delaySend);
    osc.start(time);
    osc.stop(time + 1.7);
    partial.start(time);
    partial.stop(time + 1.7);
  }

  scheduleChord(index, startTime) {
    const chord = CHORDS[index];
    const dur = BEAT * 4;
    this.bass(chord.bass, startTime);
    chord.pad.forEach((n) => this.pad(n, startTime, dur));
    // 该和弦 4 拍内的旋律
    for (let s = 0; s < 4; s++) {
      const m = MELODY[index * 4 + s];
      if (m != null) {
        const t = startTime + s * BEAT;
        if (s % 2 === 0) this.musicBox(m, t);
        else this.musicBox(m, t + BEAT * 0.5);
      }
    }
  }

  tick() {
    const ahead = 0.35;
    while (this.nextTime < this.ctx.currentTime + ahead) {
      this.scheduleChord(this.step % 4, this.nextTime);
      this.nextTime += BEAT * 4;
      this.step++;
    }
  }

  start() {
    this.ensureContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.started) {
      this.started = true;
      this.nextTime = this.ctx.currentTime + 0.15;
      this.step = 0;
      this.timer = setInterval(() => this.tick(), 60);
    }
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(0.55, this.ctx.currentTime + 1.2);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (!this.ctx) return this.muted;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.linearRampToValueAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime + 0.3);
    return this.muted;
  }
}