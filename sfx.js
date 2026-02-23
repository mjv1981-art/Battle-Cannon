(()=>{
  'use strict';
  // Simple, self-contained retro+realistic-ish SFX using WebAudio.
  // - cannon: layered low boom + crack + echo
  // - explosion: deeper boom + noise + convolver reverb
  // - click: short tick for UI
  const AC = window.AudioContext || window.webkitAudioContext;

  let ctx = null;
  let master = null;
  let convolver = null;

  function ensure(){
    if (ctx) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);

    // IR for reverb (generated)
    convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(1.4, 2.0); // duration, decay
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    convolver.connect(wet); wet.connect(master);
  }

  function now(){ return (ctx ? ctx.currentTime : 0); }

  function makeImpulse(duration, decay){
    const rate = (ctx ? ctx.sampleRate : 48000);
    const len = Math.floor(rate * duration);
    const buf = (ctx ? ctx.createBuffer(2, len, rate) : null);
    if (!buf) return null;
    for (let ch=0; ch<2; ch++){
      const data = buf.getChannelData(ch);
      for (let i=0; i<len; i++){
        const t = i / len;
        // exponential decay noise
        data[i] = (Math.random()*2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  function envGain(g, t0, a, d){
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(1.0, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  function noiseBuffer(seconds){
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const b = ctx.createBuffer(1, len, rate);
    const d = b.getChannelData(0);
    for (let i=0;i<len;i++) d[i] = Math.random()*2 - 1;
    return b;
  }

  function click(){
    ensure();
    if (ctx.state === 'suspended') ctx.resume();

    const t0 = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(800, t0);
    o.frequency.exponentialRampToValueAtTime(220, t0 + 0.035);

    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);

    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + 0.06);
  }

  function tape({gain=0.20}={}){
    // Borrowed from your Retro Waves space-shooter splash: pre-rendered
    // buffer playback is very reliable across browsers.
    ensure();
    if (ctx.state === 'suspended') ctx.resume();

    const t0 = now();
    const duration = 3.6;
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.floor(sampleRate * duration), sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      let sample = 0;

      if (t < 0.5) {
        sample = Math.random() * 0.28 - 0.14;
      } else if (t < 1.5) {
        sample = Math.sin(2 * Math.PI * 2000 * t) * 0.35 + (Math.random() * 0.10 - 0.05);
      } else if (t < 2.6) {
        const freq = (Math.sin(2 * Math.PI * 18 * t) > 0) ? 1500 : 2500;
        sample = Math.sin(2 * Math.PI * freq * t) * 0.36 + (Math.random() * 0.18 - 0.09);
      } else {
        const decay = 1 - (t - 2.6) / 1.0;
        sample = Math.sin(2 * Math.PI * 1600 * t) * 0.22 * decay;
      }

      sample += (Math.random() * 0.08 - 0.04) * (1 - t / duration);
      data[i] = Math.max(-1, Math.min(1, sample));
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const g = ctx.createGain();
    g.gain.value = gain;

    source.connect(g);
    g.connect(master);
    source.start(t0);
    source.stop(t0 + duration);
  }

  function cannon({gain=0.75}={}){
    ensure();
    if (ctx.state === 'suspended') ctx.resume();

    const t0 = now();

    // low boom
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.setValueAtTime(110, t0);
    o1.frequency.exponentialRampToValueAtTime(55, t0 + 0.18);

    const g1 = ctx.createGain();
    g1.gain.value = 0.0001;
    envGain(g1, t0, 0.01, 0.35);

    // crack (short, higher)
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.setValueAtTime(900, t0);
    o2.frequency.exponentialRampToValueAtTime(220, t0 + 0.08);

    const g2 = ctx.createGain();
    g2.gain.value = 0.0001;
    envGain(g2, t0, 0.004, 0.12);

    // noise burst (muzzle blast)
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(0.25);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 0.9;

    const gn = ctx.createGain();
    gn.gain.value = 0.0001;
    envGain(gn, t0, 0.003, 0.18);

    // bus
    const mix = ctx.createGain();
    mix.gain.value = gain;

    o1.connect(g1); g1.connect(mix);
    o2.connect(g2); g2.connect(mix);
    n.connect(bp); bp.connect(gn); gn.connect(mix);

    // dry + wet
    const dry = ctx.createGain(); dry.gain.value = 0.9;
    const wet = ctx.createGain(); wet.gain.value = 0.6;

    mix.connect(dry); dry.connect(master);
    mix.connect(wet); wet.connect(convolver);

    // echo taps (simple delay)
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.18;
    const fb = ctx.createGain(); fb.gain.value = 0.35;
    delay.connect(fb); fb.connect(delay);

    const gd = ctx.createGain(); gd.gain.value = 0.35;
    mix.connect(delay); delay.connect(gd); gd.connect(master);

    o1.start(t0); o1.stop(t0 + 0.6);
    o2.start(t0); o2.stop(t0 + 0.25);
    n.start(t0);  n.stop(t0 + 0.26);
  }

  function explosion({gain=0.85}={}){
    ensure();
    if (ctx.state === 'suspended') ctx.resume();

    const t0 = now();

    // deep boom
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(70, t0);
    o.frequency.exponentialRampToValueAtTime(35, t0 + 0.25);

    const g = ctx.createGain();
    g.gain.value = 0.0001;
    envGain(g, t0, 0.01, 0.55);

    // noise + lowpass (rumble)
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer(0.9);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;

    const gn = ctx.createGain();
    gn.gain.value = 0.0001;
    envGain(gn, t0, 0.008, 0.75);

    const mix = ctx.createGain();
    mix.gain.value = gain;

    o.connect(g); g.connect(mix);
    n.connect(lp); lp.connect(gn); gn.connect(mix);

    // dry + reverb
    const dry = ctx.createGain(); dry.gain.value = 0.8;
    const wet = ctx.createGain(); wet.gain.value = 0.9;

    mix.connect(dry); dry.connect(master);
    mix.connect(wet); wet.connect(convolver);

    o.start(t0); o.stop(t0 + 1.0);
    n.start(t0); n.stop(t0 + 0.92);
  }

  function finalBlast({gain=1.0}={}){
    // Bigger / longer / more "final" than regular shell impact.
    ensure();
    if (ctx.state === 'suspended') ctx.resume();

    const t0 = now();

    // sub boom
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(46, t0);
    sub.frequency.exponentialRampToValueAtTime(22, t0 + 0.55);
    const gsub = ctx.createGain();
    gsub.gain.value = 0.0001;
    envGain(gsub, t0, 0.012, 1.25);

    // mid boom
    const mid = ctx.createOscillator();
    mid.type = 'triangle';
    mid.frequency.setValueAtTime(95, t0);
    mid.frequency.exponentialRampToValueAtTime(38, t0 + 0.35);
    const gmid = ctx.createGain();
    gmid.gain.value = 0.0001;
    envGain(gmid, t0, 0.008, 0.85);

    // metallic crack / debris hiss
    const n1 = ctx.createBufferSource();
    n1.buffer = noiseBuffer(1.25);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.9;
    const gn = ctx.createGain();
    gn.gain.value = 0.0001;
    envGain(gn, t0, 0.004, 1.1);

    const mix = ctx.createGain();
    mix.gain.value = gain;

    sub.connect(gsub); gsub.connect(mix);
    mid.connect(gmid); gmid.connect(mix);
    n1.connect(hp); hp.connect(bp); bp.connect(gn); gn.connect(mix);

    // more wet than normal
    const dry = ctx.createGain(); dry.gain.value = 0.7;
    const wet = ctx.createGain(); wet.gain.value = 1.05;
    mix.connect(dry); dry.connect(master);
    mix.connect(wet); wet.connect(convolver);

    // tail echo
    const delay = ctx.createDelay(1.6);
    delay.delayTime.value = 0.24;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    delay.connect(fb); fb.connect(delay);
    const gd = ctx.createGain(); gd.gain.value = 0.28;
    mix.connect(delay); delay.connect(gd); gd.connect(master);

    sub.start(t0); sub.stop(t0 + 1.5);
    mid.start(t0); mid.stop(t0 + 1.2);
    n1.start(t0);  n1.stop(t0 + 1.25);
  }

  window.SFX = { click, cannon, explosion, finalBlast, tape };
})();