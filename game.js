(()=> {
  'use strict';

  // --- DOM ---
  const splash = document.getElementById('splash-screen');
  const gameContainer = document.getElementById('game-container');
  const loadingText = document.getElementById('loading-text');

  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d', { alpha:false });

  const ui = {
    hpYou: document.getElementById('hpYou'),
    hpPc: document.getElementById('hpPc'),
    hudAngle: document.getElementById('hudAngle'),
    hudPower: document.getElementById('hudPower'),
    hudWind: document.getElementById('hudWind'),
    hudTurn: document.getElementById('hudTurn'),
    gameover: document.getElementById('gameover'),
    goTitle: document.getElementById('goTitle'),
    goSub: document.getElementById('goSub'),
    mobile: document.getElementById('mobile'),
    btnRestart: document.getElementById('btnRestart'),
    hudWeapon: document.getElementById('hudWeapon'),
    hudMode: document.getElementById('hudMode'),
    modeMenu: document.getElementById('modeMenu'),
    modeTitle: document.getElementById('modeTitle'),
    rotateLock: document.getElementById('rotate-lock')
  };

  // --- constants / responsive scaling ---
  // Baseline preferred by user: Xiaomi ultrawide 3440x1440 with V2f proportions.
  const BASE_VIEW = { w: 3440, h: 1440, tankScale: 0.39 };
  const TANK_SCALE_REF = 0.78;

  function tankScale(){
    const sx = world.W / BASE_VIEW.w;
    const sy = world.H / BASE_VIEW.h;
    const fit = Math.min(sx, sy);
    return clamp(BASE_VIEW.tankScale * fit, 0.20, BASE_VIEW.tankScale);
  }
  function tankSF(){ return tankScale() / TANK_SCALE_REF; }
  function tankHalfWidth(){ return CFG.tank.halfWidth * tankSF(); }
  function tankBodyYOffset(){ return CFG.tank.bodyYOffset * tankSF(); }

  const DIFFICULTIES = {
    classic:   { name:'CLASSIC',   maxHp:100, blastScale:1.00, damageScale:1.00, windMax:22, pcTripleChance:0.18 },
    hardcore:  { name:'HARDCORE',  maxHp:150, blastScale:0.82, damageScale:0.82, windMax:30, pcTripleChance:0.32 },
    nightmare: { name:'NIGHTMARE', maxHp:200, blastScale:0.68, damageScale:0.70, windMax:40, pcTripleChance:0.46 }
  };
  let difficultyKey = 'classic';
  function mode(){ return DIFFICULTIES[difficultyKey]; }

  const WEAPONS = {
    classic: { key:'classic', label:'CLASSIC', blastRadius:1.00, damageScale:1.00 },
    triple:  { key:'triple',  label:'TRIPLE',  blastRadius:0.56, damageScale:0.45 }
  };



  function isMobileLike(){
    const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent || '');
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    const touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    const shortSide = Math.min(vw, vh);
    const portrait = vh > vw;
    return uaMobile || coarse || (touchCapable && shortSide <= 1280) || portrait;
  }

  function isPortraitLocked(){
    const vv = window.visualViewport;
    const vw = vv ? vv.width : window.innerWidth;
    const vh = vv ? vv.height : window.innerHeight;
    return isMobileLike() && vh > vw;
  }

  function updateOrientationLock(){
    const locked = isPortraitLocked();
    if (ui.rotateLock) {
      ui.rotateLock.classList.toggle('show', locked);
      ui.rotateLock.style.display = locked ? 'flex' : 'none';
    }
    document.body.style.overflow = locked ? 'hidden' : 'hidden';
    if (locked) {
      ui.mobile.style.display = 'none';
    } else if (gameState === 'playing' || gameState === 'ending') {
      if (window.innerWidth < 900 || isMobileLike()) ui.mobile.style.display = 'flex';
      else ui.mobile.style.display = 'none';
    }
    return locked;
  }

  const CFG = {
    gravity: 520,
    terrainStep: 6,               // higher resolution for better craters + slope tilt
    craterRadius: 100,            // from 70 -> 100px
    deformStrength: 45,           // from ~26 -> 45 (deeper)
    maxWind: 22,
    // vehicle physics
    tank: {
      halfWidth: 22,              // scaled down 50%
      bodyYOffset: 9,             // scaled down 50%
      mass: 1,
      slideAccel: 380,            // downhill acceleration on steep slopes
      slideFriction: 7.5,
      maxSlideSpeed: 220,
      slopeSlideDeg: 20,          // start sliding above this slope
      slopeDamageDeg: 34,         // take extra damage above this slope
      slopeDamagePerSec: 2.5,
      fallDamageThreshold: 15,    // px drop threshold
      fallDamageScale: 0.9        // dmg per px over threshold
    },
    projectile: {
      baseSpeed: 280,
      speedPerPower: 6,
      radius: 3.2
    }
  };

  // --- state ---
  let lastTime = performance.now();
  let gameState = 'loading';

  const world = {
    wind: 0,
    terrain: [],
    get W(){ return canvas.width; },
    get H(){ return canvas.height; }
  };

  function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
  function lerp(a,b,t){ return a + (b-a)*t; }

  
  function aimAngle(t){
    // World-space firing angle in degrees.
    // Barrel elevation is constrained to 0..45 degrees from horizontal, toward the opponent.
    return (t.facing === 1) ? t.elev : (180 - t.elev);
  }
function resizeCanvas(){
    const w = Math.max(320, Math.floor(window.innerWidth));
    const h = Math.max(240, Math.floor(window.innerHeight));
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w+'px';
    canvas.style.height = h+'px';
  }

  // --- terrain ---
  function generateTerrain(){
    const step = CFG.terrainStep;
    const count = Math.ceil(world.W / step) + 3;
    world.terrain = new Array(count);

    const baseY = world.H * 0.66;
    const amp1 = 34;
    const amp2 = 22;
    const amp3 = 14;

    for (let i=0;i<count;i++){
      const x = i*step;
      world.terrain[i] =
        baseY +
        Math.sin(x*0.008)*amp1 +
        Math.sin(x*0.019 + 1.2)*amp2 +
        Math.sin(x*0.034 + 2.4)*amp3;
    }
  }

  function groundAt(x){
    if (!world.terrain.length) return world.H*0.66;
    const step = CFG.terrainStep;
    const idx = Math.floor(x/step);
    const i = clamp(idx, 0, world.terrain.length-2);
    const t = (x - i*step)/step;
    return lerp(world.terrain[i], world.terrain[i+1], t);
  }

  function groundNormalAt(x){
    // estimate slope using finite difference around x
    const dx = 12;
    const yL = groundAt(x - dx);
    const yR = groundAt(x + dx);
    const dy = yR - yL;
    // tangent vector (2*dx, dy) => normal (-dy, 2*dx)
    const nx = -dy;
    const ny = 2*dx;
    const len = Math.hypot(nx, ny) || 1;
    return { nx: nx/len, ny: ny/len, slope: Math.atan2(dy, 2*dx) }; // slope angle in radians
  }

  function newWind(){
    world.wind = (Math.random()*2-1) * mode().windMax;
  }

  // --- vehicles ---
  function makeTank(isPlayer){
    return {
      x: 0, y: 0,
      vx: 0, vy: 0,
      tilt: 0,
      facing: isPlayer ? 1 : -1,   // +1 => faces right, -1 => faces left (toward opponent)
      elev: 28,                    // barrel elevation in degrees (0..45)
      power: 85,
      hp: mode().maxHp,
      alive: true,
      isPlayer,
      color: isPlayer ? '#00f7ff' : '#ff2bd6',
      lastSupportY: null,         // for fall damage
      width: CFG.tank.halfWidth*2,
      weapon: 'classic'
    };
  }

  const you = makeTank(true);
  const pc  = makeTank(false);

  function placeTanks(){
    you.x = Math.max(150, world.W * 0.16);
    pc.x  = Math.min(world.W - 150, world.W * 0.84);
    // put them on ground; physics will settle
    you.y = groundAt(you.x) - tankBodyYOffset();
    pc.y  = groundAt(pc.x)  - tankBodyYOffset();
    you.vx = you.vy = 0;
    pc.vx = pc.vy = 0;
    you.lastSupportY = groundAt(you.x);
    pc.lastSupportY = groundAt(pc.x);
  }

  function resetAimForNextTurn(tank){
    // Requirement: after a shot, the shooter's NEXT TURN starts with reset angle/power.
    // For player, keep it playable (not extreme).
    if (tank.isPlayer){
      tank.elev = 18 + Math.random()*20;
      tank.power = 70 + Math.random()*35;
    } else {
      tank.elev = 18 + Math.random()*20;
      tank.power = 70 + Math.random()*45;
    }
  }

  // --- projectile / explosion ---
  let projectiles = [];
  let explosions = [];
  // V2c: final destruction blast (different from shell impact)
  let finale = null;
  let wreckPieces = [];
  let camShake = { amp: 0 };
  let turn = 'you';
  let allowFire = true;

  const preview = { points: [], maxSteps: 65, dt: 1/34 };

  function getTargetTank(ownerTank){
    return ownerTank.isPlayer ? pc : you;
  }

  function spawnProjectile(ownerTank){
    const src = ownerTank;
    const angle = aimAngle(src);
    const power = src.power;

    const rad = angle * Math.PI/180;
    const speed = CFG.projectile.baseSpeed + power * CFG.projectile.speedPerPower;

    const m = getGunMuzzleWorld(src);
    const base = {
      x: m.x,
      y: m.y,
      vx: Math.cos(rad) * speed,
      vy: -Math.sin(rad) * speed,
      radius: CFG.projectile.radius,
      owner: ownerTank.isPlayer ? 'you' : 'pc',
      weapon: src.weapon || 'classic',
      age: 0,
      split: false
    };

    if (base.weapon === 'triple') {
      base.type = 'tripleCarrier';
      base.splitDist = 150;
      base.targetX = getTargetTank(src).x;
    } else {
      base.type = 'classic';
    }

    projectiles.push(base);

    if (window.SFX) window.SFX.cannon({ gain: 0.75 });
  }

  function computePreview(){
    preview.points = [];
    if (gameState !== 'playing' || turn !== 'you' || projectiles.length) return;

    const rad = aimAngle(you) * Math.PI/180;
    const speed = CFG.projectile.baseSpeed + you.power * CFG.projectile.speedPerPower;

    let vx = Math.cos(rad) * speed;
    let vy = -Math.sin(rad) * speed;

    const m = getGunMuzzleWorld(you);
    let x = m.x, y = m.y;

    for (let i=0;i<preview.maxSteps;i++){
      preview.points.push({x,y});
      vx += world.wind * preview.dt;
      vy += CFG.gravity * preview.dt;
      x  += vx * preview.dt;
      y  += vy * preview.dt;
      if (x < -50 || x > world.W+50) break;
      if (y >= groundAt(x)) break;
    }
  }

  function pushExplosion(x, y, maxR, palette='classic'){
    explosions.push({ x, y, r: 0, t: 0, maxR, palette });
  }

  function maybeAdvanceTurn(owner){
    if (projectiles.length || gameState !== 'playing') return;
    if (turn === 'you'){
      turn = 'pc';
      resetAimForNextTurn(you);
      newWind();
      updateHUD();
      computePreview();
      setTimeout(pcTurn, 650);
    } else {
      turn = 'you';
      resetAimForNextTurn(pc);
      newWind();
      updateHUD();
      computePreview();
    }
  }

  function splitTripleProjectile(p){
    pushExplosion(p.x, p.y, 24, 'split');
    const spread = [-0.22, 0, 0.22];
    const baseV = Math.hypot(p.vx, p.vy) * 0.88;
    return spread.map(d => {
      const ang = Math.atan2(p.vy, p.vx) + d;
      return {
        x: p.x,
        y: p.y,
        vx: Math.cos(ang) * baseV,
        vy: Math.sin(ang) * baseV - 18,
        radius: CFG.projectile.radius * 0.85,
        owner: p.owner,
        weapon: 'tripleChild',
        type: 'tripleChild',
        age: 0
      };
    });
  }

  function impact(proj, x, y){
    const wcfg = proj.type === 'tripleChild' ? WEAPONS.triple : WEAPONS.classic;
    const crater = CFG.craterRadius * wcfg.blastRadius * mode().blastScale;
    const deform = CFG.deformStrength * wcfg.blastRadius;

    pushExplosion(x, y, crater, proj.type === 'tripleChild' ? 'triple' : 'classic');
    deformTerrain(x, y, crater, deform);

    if (window.SFX) window.SFX.explosion({ gain: proj.type === 'tripleChild' ? 0.62 : 0.85 });

    applyBlastDamage(x, y, crater, wcfg.damageScale);

    updateHUD();

    if (you.hp <= 0) { startFinale(you, 'pc'); return; }
    if (pc.hp  <= 0) { startFinale(pc,  'you'); return; }

  }

  function deformTerrain(cx, cy, radius, strength){
    const step = CFG.terrainStep;
    const startIdx = Math.max(0, Math.floor((cx - radius) / step));
    const endIdx   = Math.min(world.terrain.length - 1, Math.ceil((cx + radius) / step));

    for (let i=startIdx;i<=endIdx;i++){
      const px = i * step;
      const dist = Math.abs(px - cx);
      if (dist > radius) continue;

      const f = 1 - dist / radius;         // 0..1
      // deeper and smoother bowl
      world.terrain[i] += strength * Math.pow(f, 2.2);
      // add some jaggedness near center (electric vibe)
      if (f > 0.6) world.terrain[i] += (Math.random()*2 - 1) * (f*3);
    }
  }

  function applyBlastDamage(x,y, radius, damageScale=1){
    const blastR = radius * 1.05;
    [you, pc].forEach(t => {
      const tx = t.x;
      const ty = t.y - 26*tankSF(); // turret center-ish (scaled)
      const d = Math.hypot(x - tx, y - ty);
      if (d < blastR){
        const dmg = Math.round((42 * (1 - d/blastR) + 6) * damageScale * mode().damageScale);
        t.hp = Math.max(0, t.hp - dmg);
      }
    });
  }

  function kickShake(amp){
    camShake.amp = Math.max(camShake.amp, amp);
  }

  function startFinale(loser, winner){
    // Final blast differs from shell blow: bigger, electric-blue, spawns wreck pieces, then shows result.
    if (gameState === 'ending' || gameState === 'over') return;

    gameState = 'ending';
    allowFire = false;
    projectiles = [];
    explosions = [];

    loser.alive = false;

    // Big crater / hole
    const cx = loser.x;
    const cy = groundAt(cx);
    deformTerrain(cx, cy, 160, 88);

    // Wreck pieces
    wreckPieces = [];
    for (let i=0;i<14;i++){
      const a = Math.random()*Math.PI*2;
      const sp = 140 + Math.random()*260;
      wreckPieces.push({
        x: loser.x + (Math.random()*18 - 9),
        y: (loser.y - 16*tankSF()) + (Math.random()*16 - 8),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - (220 + Math.random()*220),
        r: (Math.random()*2-1)*Math.PI,
        vr: (Math.random()*2-1)*7,
        s: 6 + Math.random()*14,
        life: 2.3 + Math.random()*0.7,
        color: loser.color
      });
    }

    finale = {
      winner,
      x: loser.x,
      y: (loser.y - 26*tankSF()),
      t: 0,
      dur: 1.15
    };

    kickShake(10);
    if (window.SFX?.finalBlast) window.SFX.finalBlast({ gain: 1.0 });
    else if (window.SFX) window.SFX.explosion({ gain: 1.05 });

    updateHUD();
  }

  function endGame(winner){
    gameState = 'over';
    ui.gameover.style.display = 'flex';
    ui.goTitle.textContent = winner === 'you' ? '🏆 YOU WIN!' : '💀 YOU LOSE';
    ui.goSub.textContent = winner === 'you' ? 'Enemy SPH destroyed' : 'Your SPH was destroyed';
  }

  // --- pc AI ---
  function pcTurn(){
    if (gameState !== 'playing' || turn !== 'pc' || projectiles.length) return;

    const targetX = you.x;
    const targetY = you.y - 25;

    // PC always faces left, so its world firing angle is (180 - elev).
    let best = { d: Infinity, elev: 24, pow: 95 };

    for (let elev=6; elev<=45; elev+=3){
      const ang = 180 - elev;
      for (let pow=55; pow<=140; pow+=9){
        const rad = ang * Math.PI/180;
        const speed = CFG.projectile.baseSpeed + pow * CFG.projectile.speedPerPower;

        let vx = Math.cos(rad) * speed;
        let vy = -Math.sin(rad) * speed;

        const m = getGunMuzzleWorld(pc);
        let x = m.x, y = m.y;

        for (let s=0;s<92;s++){
          vx += world.wind * 0.025;
          vy += CFG.gravity * 0.025;
          x  += vx * 0.025;
          y  += vy * 0.025;

          if (x < -80 || x > world.W+80 || y > world.H+120) break;
          if (y >= groundAt(x)) break;

          const d = Math.hypot(x - targetX, y - targetY);
          if (d < best.d){
            best = { d, elev, pow };
          }
        }
      }
    }

    pc.elev = clamp(best.elev + (Math.random()-0.5) * 2.0, 0, 45);
    pc.power = clamp(best.pow + (Math.random()-0.5) * 8, 30, 150);
    pc.weapon = Math.random() < mode().pcTripleChance ? 'triple' : 'classic';
    spawnProjectile(pc);
  }

  // --- input ---
  function changeAngle(delta){
    if (gameState !== 'playing' || turn !== 'you' || projectiles.length) return;
    you.elev = clamp(you.elev + delta, 0, 45);
    computePreview();
    updateHUD();
    if (window.SFX) window.SFX.click();
  }
  function changePower(delta){
    if (gameState !== 'playing' || turn !== 'you' || projectiles.length) return;
    you.power = clamp(you.power + delta, 30, 150);
    computePreview();
    updateHUD();
    if (window.SFX) window.SFX.click();
  }
  function changeWeapon(){
    if (gameState !== 'playing' || turn !== 'you' || projectiles.length) return;
    you.weapon = (you.weapon === 'classic') ? 'triple' : 'classic';
    computePreview();
    updateHUD();
    if (window.SFX) window.SFX.click();
  }

  function fire(){
    if (gameState !== 'playing' || turn !== 'you' || projectiles.length || !allowFire) return;
    allowFire = false;
    setTimeout(()=> allowFire = true, 450);
    spawnProjectile(you);
    updateHUD();
  }

  // --- HUD ---
  function updateHUD(){
    ui.hpYou.style.width = `${clamp(you.hp / mode().maxHp * 100,0,100)}%`;
    ui.hpPc.style.width  = `${clamp(pc.hp / mode().maxHp * 100,0,100)}%`;
    ui.hudAngle.textContent = `${Math.round(you.elev)}°`;
    ui.hudPower.textContent = `${Math.round(you.power)}`;
    ui.hudWind.textContent  = (world.wind>=0?'+':'') + world.wind.toFixed(1);
    ui.hudTurn.textContent  = turn === 'you' ? 'YOU' : 'PC';
    if (ui.hudWeapon) ui.hudWeapon.textContent = WEAPONS[you.weapon]?.label || 'CLASSIC';
    if (ui.hudMode) ui.hudMode.textContent = mode().name;
  }

  // --- physics (tanks) ---
  function updateTankPhysics(t, dt){
    // sample ground under left & right track contact points
    const hw = tankHalfWidth();
    const gxL = clamp(t.x - hw, 0, world.W);
    const gxR = clamp(t.x + hw, 0, world.W);
    const gL = groundAt(gxL);
    const gR = groundAt(gxR);

    // desired support line is avg of L/R
    const gMid = (gL + gR) * 0.5;

    // slope in radians
    const slope = Math.atan2(gR - gL, (gxR - gxL));

    // tilt follows ground slope smoothly
    const tiltTarget = clamp(slope, -0.55, 0.55); // ~±31.5°
    t.tilt += (tiltTarget - t.tilt) * clamp(dt*10, 0, 1);

    // supportY is highest point under tracks? if one side is missing, tank can tip/fall.
    // if crater removes ground heavily, gMid increases (down), so tank falls.
    const supportY = gMid;

    // gravity
    t.vy += CFG.gravity * dt;

    // integrate
    t.x += t.vx * dt;
    t.y += t.vy * dt;

    // bounds
    t.x = clamp(t.x, 60, world.W - 60);

    // collision / landing: tank bottom sits at supportY - bodyYOffset
    const desiredY = supportY - tankBodyYOffset();

    if (t.y > desiredY){
      // landing / grounding
      const prevSupport = t.lastSupportY ?? supportY;
      const drop = (supportY - prevSupport); // positive if ground went down compared to last support
      if (drop > CFG.tank.fallDamageThreshold){
        const dmg = Math.round((drop - CFG.tank.fallDamageThreshold) * CFG.tank.fallDamageScale);
        t.hp = Math.max(0, t.hp - dmg);
      }

      t.y = desiredY;
      t.vy = 0;

      // sliding on slopes
      const slopeDeg = Math.abs(tiltTarget) * 180/Math.PI;
      if (slopeDeg > CFG.tank.slopeSlideDeg){
        const dir = tiltTarget > 0 ? 1 : -1; // downhill direction (positive slope => downhill right)
        t.vx += dir * CFG.tank.slideAccel * dt;
        // friction
        t.vx -= t.vx * CFG.tank.slideFriction * dt;
        t.vx = clamp(t.vx, -CFG.tank.maxSlideSpeed, CFG.tank.maxSlideSpeed);

        if (slopeDeg > CFG.tank.slopeDamageDeg){
          t.hp = Math.max(0, t.hp - CFG.tank.slopeDamagePerSec * dt);
        }
      } else {
        // settle / friction
        t.vx -= t.vx * 10.0 * dt;
      }

      t.lastSupportY = supportY;
    } else {
      // airborne; keep lastSupportY so we can measure drop on landing
      t.vx -= t.vx * 1.2 * dt; // mild air drag
    }
  }

  // --- projectile physics ---
  function updateProjectile(dt){
    if (!projectiles.length) return;

    const survivors = [];
    let lastOwner = null;

    for (const p of projectiles){
      p.age = (p.age || 0) + dt;
      p.vx += world.wind * dt;
      p.vy += CFG.gravity * dt;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;

      if (p.type === 'tripleCarrier' && !p.split) {
        const nearTarget = Math.abs(p.x - p.targetX) < p.splitDist;
        const descending = p.vy > 20 && p.age > 0.38;
        if (nearTarget && descending){
          p.split = true;
          survivors.push(...splitTripleProjectile(p));
          continue;
        }
      }

      if (p.x < -120 || p.x > world.W + 120 || p.y > world.H + 160){
        lastOwner = p.owner;
        impact(p, p.x, Math.min(p.y, world.H));
        continue;
      }

      const gY = groundAt(p.x);
      if (p.y >= gY){
        lastOwner = p.owner;
        impact(p, p.x, gY);
        continue;
      }

      const hitTank = (t) => (t.alive !== false) && Math.hypot(p.x - t.x, p.y - (t.y - 26*tankSF())) < (26*tankSF());
      if (hitTank(you) || hitTank(pc)){
        lastOwner = p.owner;
        impact(p, p.x, p.y);
        continue;
      }

      survivors.push(p);
    }

    projectiles = survivors;
    if (!projectiles.length && lastOwner && gameState === 'playing') maybeAdvanceTurn(lastOwner);
  }

  // --- loop ---
  function update(dt){
    if (gameState !== 'playing') return;

    // explosion anims
    for (const ex of explosions){
      ex.t += dt;
      ex.r = ex.maxR * Math.min(1, ex.t / 0.18);
    }
    explosions = explosions.filter(ex => ex.t <= 0.55);

    // tanks physics always (so they can fall after blast)
    updateTankPhysics(you, dt);
    updateTankPhysics(pc, dt);

    // if tank died due to fall/slope damage
    if (you.hp <= 0) { startFinale(you, 'pc'); return; }
    if (pc.hp  <= 0) { startFinale(pc,  'you'); return; }

    updateProjectile(dt);
    updateHUD();
  }

  function updateEnding(dt){
    if (gameState !== 'ending') return;

    // keep the remaining tank settling (and allow pieces to collide with terrain)
    updateTankPhysics(you, dt);
    updateTankPhysics(pc, dt);

    // wreck pieces
    for (const p of wreckPieces){
      p.vy += CFG.gravity * dt;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.r  += p.vr * dt;
      p.life -= dt;

      const gy = groundAt(p.x);
      if (p.y >= gy){
        p.y = gy;
        p.vy *= -0.28;
        p.vx *= 0.72;
        p.vr *= 0.6;
        if (Math.abs(p.vy) < 40) p.vy = 0;
      }
    }
    wreckPieces = wreckPieces.filter(p => p.life > 0.05);

    // shake decay
    camShake.amp *= Math.exp(-3.2 * dt);

    if (finale){
      finale.t += dt;
      if (finale.t >= finale.dur){
        const w = finale.winner;
        finale = null;
        endGame(w);
      }
    }
    updateHUD();
  }

  // --- render ---
  function drawBackground(){
    const grad = ctx.createLinearGradient(0,0,0,world.H);
    grad.addColorStop(0,'#071038');
    grad.addColorStop(0.68,'#1a1030');
    grad.addColorStop(1,'#07031a');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,world.W,world.H);

    // circuit lines
    ctx.save();
    ctx.globalAlpha = 0.35;
    for (let i=0;i<18;i++){
      const x = (i*137) % world.W;
      const y = (i*83) % Math.floor(world.H*0.55);
      ctx.strokeStyle = i%2 ? '#00f7ff' : '#ff2bd6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x,y);
      ctx.lineTo(x+60,y);
      ctx.lineTo(x+60,y+30);
      ctx.lineTo(x+140,y+30);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = 0.12;
      ctx.fillRect(x+55,y+25,6,6);
      ctx.globalAlpha = 0.35;
    }
    ctx.restore();

    // stars
    ctx.save();
    ctx.fillStyle = '#ffffff';
    for (let i=0;i<110;i++){
      const x = (i*37) % world.W;
      const y = (i*23) % Math.floor(world.H*0.6);
      ctx.globalAlpha = 0.35 + (Math.sin(i*1.3)*0.2);
      ctx.fillRect(x,y,2,2);
    }
    ctx.restore();

    // horizon glow
    const g2 = ctx.createRadialGradient(world.W/2, world.H*0.62, 50, world.W/2, world.H*0.62, 520);
    g2.addColorStop(0,'rgba(255,43,214,0.18)');
    g2.addColorStop(0.55,'rgba(0,247,255,0.09)');
    g2.addColorStop(1,'transparent');
    ctx.fillStyle = g2;
    ctx.fillRect(0,0,world.W,world.H);
  }

  function drawTerrain(){
    if (!world.terrain.length) return;

    ctx.beginPath();
    ctx.moveTo(0, world.H);
    ctx.lineTo(0, groundAt(0));

    for (let x=0; x<=world.W; x+=CFG.terrainStep){
      ctx.lineTo(x, groundAt(x));
    }

    ctx.lineTo(world.W, world.H);
    ctx.closePath();

    const grad = ctx.createLinearGradient(0, groundAt(0), 0, world.H);
    grad.addColorStop(0, '#354c3a');
    grad.addColorStop(0.7, '#142314');
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = '#52ff8a';
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.stroke();

    // electric cracks on cratered areas (cheap scan)
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.strokeStyle = '#00f7ff';
    ctx.lineWidth = 1.5;
    for (let i=0;i<24;i++){
      const sx = (i*199) % world.W;
      const sy = groundAt(sx) + 12;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 24, sy + 18);
      ctx.lineTo(sx + 50, sy + 10);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPreview(){
    if (!preview.points.length || turn !== 'you' || projectiles.length) return;
    ctx.save();
    ctx.strokeStyle = '#00f7ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5,5]);
    ctx.beginPath();
    for (let i=0;i<preview.points.length;i++){
      const p = preview.points[i];
      if (i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawProjectile(){
    if (!projectiles.length) return;
    for (const projectile of projectiles){
      ctx.save();
      ctx.translate(projectile.x, projectile.y);
      const a = Math.atan2(projectile.vy, projectile.vx);
      ctx.rotate(a);

      const triple = projectile.type === 'tripleCarrier' || projectile.type === 'tripleChild';
      ctx.shadowColor = triple ? '#00f7ff' : '#ffaa00';
      ctx.shadowBlur = triple ? 14 : 18;

      const bodyLen = projectile.type === 'tripleChild' ? 12 : 16;
      const bodyH = projectile.type === 'tripleChild' ? 3.6 : 4.4;
      ctx.fillStyle = triple ? '#c8faff' : '#d8d8d8';
      ctx.beginPath();
      ctx.roundRect(-bodyLen/2, -bodyH/2, bodyLen, bodyH, 2.2);
      ctx.fill();

      ctx.fillStyle = '#f2f2f2';
      ctx.beginPath();
      ctx.moveTo(bodyLen/2, 0);
      ctx.lineTo(bodyLen/2 - 4, -bodyH/2);
      ctx.lineTo(bodyLen/2 - 4, bodyH/2);
      ctx.closePath();
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.65;
      ctx.fillStyle = triple ? '#00f7ff' : '#ffaa00';
      ctx.fillRect(-bodyLen/2 - 6, -1, 6, 2);
      ctx.globalAlpha = 1;

      ctx.restore();
    }
  }

  function drawExplosion(){
    if (!explosions.length) return;
    for (const explosion of explosions){
      const {x,y,r,maxR,palette} = explosion;
      ctx.save();

      const grad = ctx.createRadialGradient(x,y, 0, x,y, r*1.45);
      if (palette === 'triple' || palette === 'split'){
        grad.addColorStop(0, '#f9ffff');
        grad.addColorStop(0.35, '#82f6ff');
        grad.addColorStop(0.72, '#3a8cff');
        grad.addColorStop(1, 'transparent');
      } else {
        grad.addColorStop(0, '#fff6b0');
        grad.addColorStop(0.35, '#ff9a2a');
        grad.addColorStop(0.72, '#ff2b2b');
        grad.addColorStop(1, 'transparent');
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x,y, r*1.45, 0, Math.PI*2);
      ctx.fill();

      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x,y, Math.min(maxR*1.1, r*1.2), 0, Math.PI*2);
      ctx.stroke();

      ctx.restore();
    }
  }

  function drawFinale(){
    if (!finale) return;
    const t = finale.t;
    const k = Math.min(1, t / 0.22);
    const x = finale.x, y = finale.y;
    const R = 210 * k;

    ctx.save();

    // electric-blue core (distinct from the orange shell blow)
    const g = ctx.createRadialGradient(x,y, 0, x,y, R);
    g.addColorStop(0, '#eaffff');
    g.addColorStop(0.18, '#7df7ff');
    g.addColorStop(0.48, '#4a6bff');
    g.addColorStop(0.78, '#a22bff');
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x,y, R, 0, Math.PI*2);
    ctx.fill();

    // rays
    ctx.globalAlpha = 0.55 * (1 - Math.min(1, t/1.15));
    ctx.strokeStyle = '#c7ffff';
    ctx.lineWidth = 2;
    for (let i=0;i<18;i++){
      const a = (i/18)*Math.PI*2 + t*1.6;
      const r1 = 18;
      const r2 = 120 + 90*Math.sin(t*4 + i);
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a)*r1, y + Math.sin(a)*r1);
      ctx.lineTo(x + Math.cos(a)*r2, y + Math.sin(a)*r2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // shock ring
    ctx.globalAlpha = 0.32;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x,y, 70 + 220*Math.min(1, t/0.85), 0, Math.PI*2);
    ctx.stroke();

    ctx.restore();
  }

  function drawWreckPieces(){
    if (!wreckPieces.length) return;
    ctx.save();
    for (const p of wreckPieces){
      const a = Math.max(0, Math.min(1, p.life/2.6));
      ctx.globalAlpha = 0.9 * a;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#1b2430';
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-p.s*0.6, -p.s*0.35, p.s*1.2, p.s*0.7, 3);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // --- tank drawing (electric style, more detailed) ---
  function drawTank(t){
    if (t.alive === false) return;
    const x = t.x;
    const y = t.y;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t.tilt);
    ctx.scale(t.facing || 1, 1);

    // glow
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 16;

    // scale (V2c: 50% of V2b)
    const s = tankScale();

    // --- separate tracks (left/right), with links ---
    const trackLen = 120*s;
    const trackH = 26*s;
    const trackY = 22*s;
    const trackX = -trackLen/2;

    // outer track body
    ctx.fillStyle = '#1b2430';
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2.2*s;

    // left track band
    ctx.beginPath();
    ctx.roundRect(trackX, trackY, trackLen, trackH, 10*s);
    ctx.fill();
    ctx.stroke();

    // track links detail
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#00f7ff';
    for (let i=0;i<18;i++){
      const lx = trackX + 6*s + i*(trackLen-12*s)/18;
      ctx.beginPath();
      ctx.moveTo(lx, trackY + 4*s);
      ctx.lineTo(lx+3*s, trackY + trackH - 4*s);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // --- wheels with hubs ---
    ctx.shadowBlur = 10;
    const wheels = 6;
    for (let i=0;i<wheels;i++){
      const wx = trackX + (i+0.5)*(trackLen/wheels);
      const wy = trackY + trackH*0.62;
      const r = 8.2*s;

      // wheel
      ctx.fillStyle = '#0f141a';
      ctx.strokeStyle = t.color;
      ctx.lineWidth = 1.6*s;
      ctx.beginPath();
      ctx.arc(wx, wy, r, 0, Math.PI*2);
      ctx.fill();
      ctx.stroke();

      // hub
      ctx.fillStyle = '#2f3a46';
      ctx.beginPath();
      ctx.arc(wx, wy, r*0.45, 0, Math.PI*2);
      ctx.fill();

      // hub bolts
      ctx.fillStyle = '#cfe8ff';
      for (let b=0;b<5;b++){
        const a = b*(Math.PI*2/5);
        ctx.beginPath();
        ctx.arc(wx + Math.cos(a)*r*0.24, wy + Math.sin(a)*r*0.24, 1.2*s, 0, Math.PI*2);
        ctx.fill();
      }
    }

    // --- hull with sloped armor ---
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#0b2b3c';
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2.4*s;
    ctx.beginPath();
    ctx.moveTo(-58*s, 18*s);
    ctx.lineTo(58*s, 18*s);
    ctx.lineTo(50*s, -8*s);
    ctx.lineTo(-46*s, -8*s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // hull panel lines + neon traces
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#6feeff';
    ctx.lineWidth = 1.1*s;
    ctx.beginPath();
    ctx.moveTo(-40*s, 6*s);
    ctx.lineTo(8*s, 6*s);
    ctx.lineTo(18*s, -2*s);
    ctx.lineTo(42*s, -2*s);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // --- turret (detailed) ---
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#123e57';
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2.3*s;

    ctx.beginPath();
    ctx.roundRect(-32*s, -30*s, 76*s, 22*s, 10*s);
    ctx.fill();
    ctx.stroke();

    // turret top plate
    ctx.fillStyle = '#0a3146';
    ctx.beginPath();
    ctx.roundRect(-22*s, -42*s, 50*s, 14*s, 9*s);
    ctx.fill();
    ctx.stroke();

    // hatch
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0f141a';
    ctx.strokeStyle = '#cfe8ff';
    ctx.lineWidth = 1.2*s;
    ctx.beginPath();
    ctx.arc(10*s, -35*s, 6.2*s, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

    // --- cannon (long, realistic, muzzle brake) ---
    const localAim = (t.elev * Math.PI/180);

    ctx.save();
    ctx.translate(20*s, -30*s);
    ctx.rotate(-localAim); // canvas y grows down, so use -angle

    // mantlet / gun mount (makes barrel feel connected to turret)
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#0a1c26';
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 2.0*s;
    ctx.beginPath();
    ctx.roundRect(-10*s, -9*s, 26*s, 18*s, 6*s);
    ctx.fill();
    ctx.stroke();

    // inner collar
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#141d24';
    ctx.beginPath();
    ctx.roundRect(-2*s, -5*s, 12*s, 10*s, 4*s);
    ctx.fill();

    // barrel glow layer
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = '#bafff3';
    ctx.lineWidth = 6.2*s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0,0);
    ctx.lineTo(110*s,0);
    ctx.stroke();

    // inner barrel
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#0f1a22';
    ctx.lineWidth = 4.0*s;
    ctx.beginPath();
    ctx.moveTo(2*s,0);
    ctx.lineTo(110*s,0);
    ctx.stroke();

    // muzzle brake
    ctx.fillStyle = '#1a2530';
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 1.6*s;
    ctx.beginPath();
    ctx.roundRect(108*s, -6*s, 16*s, 12*s, 3*s);
    ctx.fill();
    ctx.stroke();
    // brake ports
    ctx.fillStyle = '#0a0f14';
    ctx.fillRect(112*s, -3*s, 4*s, 2*s);
    ctx.fillRect(118*s, 1*s, 4*s, 2*s);

    // barrel rings
    ctx.strokeStyle = '#6feeff';
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1.4*s;
    for (let r=0;r<3;r++){
      const bx = 24*s + r*26*s;
      ctx.beginPath();
      ctx.moveTo(bx, -4*s);
      ctx.lineTo(bx, 4*s);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    ctx.restore();
    ctx.restore();

    // underglow sparks (electric)
    ctx.save();
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 24;
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-40*s, trackY + trackH + 2*s);
    ctx.lineTo(-20*s, trackY + trackH + 10*s);
    ctx.lineTo(0,    trackY + trackH + 4*s);
    ctx.lineTo(18*s, trackY + trackH + 14*s);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  function getGunMuzzleLocal(t){
    // local point where barrel ends (approx), for projectile spawn
    // NOTE: local space assumes "forward" is +X. Facing is applied in getGunMuzzleWorld().
    const s = tankScale();

    const localAim = (t.elev * Math.PI/180); // 0..45 degrees above horizontal
    const base = { x: 20*s, y: -30*s };      // closer to turret front for better "connected" barrel
    const len = 118*s;

    return { x: base.x + Math.cos(localAim)*len, y: base.y - Math.sin(localAim)*len };
  }

  function getGunMuzzleWorld(t){
    const p = getGunMuzzleLocal(t);
    const cosT = Math.cos(t.tilt), sinT = Math.sin(t.tilt);

    // apply facing mirror before tilt rotation (matches drawTank() transform order)
    const sx = p.x * (t.facing || 1);
    const sy = p.y;

    return { x: t.x + sx*cosT - sy*sinT, y: t.y + sx*sinT + sy*cosT };
  }

  // --- render loop ---
  function render(){
    // camera shake
    const s = camShake.amp;
    const dx = (s > 0.2) ? (Math.random()*2 - 1) * s : 0;
    const dy = (s > 0.2) ? (Math.random()*2 - 1) * s : 0;

    ctx.save();
    ctx.translate(dx, dy);

    drawBackground();
    drawTerrain();
    drawPreview();
    drawTank(you);
    drawTank(pc);
    drawWreckPieces();
    drawProjectile();
    drawExplosion();
    drawFinale();

    ctx.restore();
  }

  function loop(){
    const orientationLocked = updateOrientationLock();
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime)/1000);
    lastTime = now;

    if (!orientationLocked) {
      if (gameState === 'playing') update(dt);
      else if (gameState === 'ending') updateEnding(dt);
    }
    if (!orientationLocked) render();
    requestAnimationFrame(loop);
  }

  function showModeMenu(title='Choose difficulty'){
    ui.modeTitle.textContent = title;
    ui.modeMenu.style.display = 'flex';
  }

  function selectMode(key){
    difficultyKey = key;
    ui.modeMenu.style.display = 'none';
    initGame();
  }

  // --- init / start ---
  function initGame(){
    gameState = 'playing';
    resizeCanvas();
    generateTerrain();
    placeTanks();
    newWind();

    you.hp = mode().maxHp; pc.hp = mode().maxHp;
    you.alive = true; pc.alive = true;
    you.elev = 28; you.power = 85;
    pc.elev = 28; pc.power = 85;
    you.facing = 1;
    pc.facing = -1;
    you.tilt = 0; pc.tilt = 0;
    you.lastSupportY = groundAt(you.x);
    pc.lastSupportY = groundAt(pc.x);

    projectiles = [];
    explosions = [];
    finale = null;
    wreckPieces = [];
    camShake.amp = 0;
    allowFire = true;
    turn = 'you';
    you.weapon = 'classic';
    pc.weapon = 'classic';

    updateHUD();
    computePreview();
    ui.gameover.style.display = 'none';

    // Mobile controls visibility / orientation lock
    updateOrientationLock();
  }

  // keyboard
  window.addEventListener('keydown', (e)=>{
    if (gameState !== 'playing') return;

    if (e.code === 'ArrowLeft')  { e.preventDefault(); changeAngle(-2); }
    if (e.code === 'ArrowRight') { e.preventDefault(); changeAngle(2); }
    if (e.code === 'ArrowUp')    { e.preventDefault(); changePower(3); }
    if (e.code === 'ArrowDown')  { e.preventDefault(); changePower(-3); }
    if (e.code === 'KeyQ')       { e.preventDefault(); changeWeapon(); }
    if (e.code === 'Space')      { e.preventDefault(); fire(); }
  }, { passive:false });

  // mobile buttons (with click sound)
  document.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('pointerdown', (e)=>{
      e.preventDefault();
      const act = btn.dataset.act;
      if (window.SFX) window.SFX.click();
      if (act === 'angleUp') changeAngle(2);
      if (act === 'angleDn') changeAngle(-2);
      if (act === 'powerUp') changePower(3);
      if (act === 'powerDn') changePower(-3);
      if (act === 'weapon') changeWeapon();
      if (act === 'fire') fire();
    }, { passive:false });
  });

  ui.btnRestart.addEventListener('click', ()=>{
    if (window.SFX) window.SFX.click();
    ui.gameover.style.display = 'none';
    showModeMenu('Choose difficulty');
  });

  document.querySelectorAll('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (window.SFX) window.SFX.click();
      selectMode(btn.dataset.mode);
    });
  });

  window.addEventListener('resize', ()=>{
    updateOrientationLock();
    if (gameState !== 'playing' && gameState !== 'ending') return;
    resizeCanvas();
    generateTerrain();
    // keep positions but clamp
    you.x = clamp(you.x, 60, world.W-60);
    pc.x  = clamp(pc.x,  60, world.W-60);
    // keep physics stable
    you.lastSupportY = groundAt(you.x);
    pc.lastSupportY  = groundAt(pc.x);
    computePreview();
  });

  // splash click/tap/enter -> start
  function startFromSplash(){
    if (gameState !== 'loading') return;
    gameState = 'starting';
    loadingText.textContent = '> TAPE LOADING... <';
    if (window.SFX) window.SFX.tape({ gain: 0.20 });

    let dots = 0;
    const interval = setInterval(()=>{
      dots = (dots + 1) % 4;
      loadingText.textContent = '> TAPE LOADING' + '.'.repeat(dots) + ' <';
    }, 300);

    setTimeout(()=>{
      clearInterval(interval);
      splash.style.display = 'none';
      gameContainer.style.display = 'block';
      updateOrientationLock();
      showModeMenu('Choose difficulty');
    }, 3600);
  }

  splash.addEventListener('click', startFromSplash);
  splash.addEventListener('pointerdown', (e)=>{ e.preventDefault(); startFromSplash(); }, { passive:false });
  splash.addEventListener('keydown', (e)=>{
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); startFromSplash(); }
  });

  window.addEventListener('orientationchange', ()=> setTimeout(updateOrientationLock, 60));
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', updateOrientationLock);
    visualViewport.addEventListener('scroll', updateOrientationLock);
  }

  // go
  updateOrientationLock();
  resizeCanvas();
  lastTime = performance.now();
  loop();
})();