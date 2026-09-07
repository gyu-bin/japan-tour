import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * 무료 최대치:
 * - Poly Haven CC0 PBR 텍스처 (로컬 assets/tex)
 * - PointLight 소수 + emissive 초롱
 * - 상점 파사드를 레이어로 디테일
 *
 * Astra(Blender→Unreal) 수준 실사는 이 파이프라인으로는 불가.
 */

const THEME = {
  night:    { fog: 0x2a2038, fogDen: 0.022, amb: 0.55, bloom: 0.8, warm: 0.1 },
  asakusa:  { fog: 0x3a2838, fogDen: 0.018, amb: 0.65, bloom: 0.9, warm: 0.12 },
  odaiba:   { fog: 0x1a2844, fogDen: 0.016, amb: 0.55, bloom: 0.85, warm: 0.04 },
  roppongi: { fog: 0x222830, fogDen: 0.018, amb: 0.52, bloom: 0.8, warm: 0.06 },
  fuji:     { fog: 0x6a90a8, fogDen: 0.01, amb: 0.9, bloom: 0.35, warm: 0.02 }
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uWarm: { value: 0.1 },
    uContrast: { value: 1.08 },
    uVignette: { value: 0.38 }
  },
  vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader: `
    uniform sampler2D tDiffuse;uniform float uWarm,uContrast,uVignette;varying vec2 vUv;
    void main(){
      vec4 c=texture2D(tDiffuse,vUv);
      c.rgb=(c.rgb-.5)*uContrast+.5;
      c.r+=uWarm*.06;c.b-=uWarm*.03;
      float d=distance(vUv,vec2(.5));
      c.rgb*=smoothstep(1.0,.38,d*(.8+uVignette));
      gl_FragColor=c;
    }`
};

function loadTex(url, repeatX = 1, repeatY = 1) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, tex => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.anisotropy = 8;
      resolve(tex);
    }, undefined, reject);
  });
}

function loadDataTex(url, repeatX = 1, repeatY = 1) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, tex => {
      tex.colorSpace = THREE.NoColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.anisotropy = 8;
      resolve(tex);
    }, undefined, reject);
  });
}

export async function createWalk(container, { day, startIdx = 0, onNear, onLeave }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 140);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffd0b0, 0x1a1018, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffb090, 0.4);
  sun.position.set(-6, 22, 10);
  scene.add(sun);

  const keyLights = [0, 1, 2, 3, 4].map(() => {
    const pl = new THREE.PointLight(0xff6a40, 0, 14, 2);
    scene.add(pl);
    return pl;
  });
  let lightIdx = 0;
  const placeLight = (x, y, z, hex, inten = 2.4) => {
    const pl = keyLights[lightIdx % keyLights.length];
    lightIdx++;
    pl.color.setHex(hex);
    pl.intensity = inten;
    pl.position.set(x, y, z);
  };

  const world = new THREE.Group();
  scene.add(world);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.45, 0.8);
  composer.addPass(bloom);
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  composer.addPass(new OutputPass());

  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
    cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
    sph: new THREE.SphereGeometry(1, 10, 8),
    cone: new THREE.ConeGeometry(1, 1, 12),
    plane: new THREE.PlaneGeometry(1, 1)
  };

  const base = new URL('../assets/tex/', import.meta.url);
  const [
    cobbleDiff, cobbleNor, cobbleRough,
    woodDiff, woodNor, woodRough,
    roofDiff, roofNor
  ] = await Promise.all([
    loadTex(new URL('cobble_diff.jpg', base).href, 6, 28),
    loadDataTex(new URL('cobble_nor.jpg', base).href, 6, 28),
    loadDataTex(new URL('cobble_rough.jpg', base).href, 6, 28),
    loadTex(new URL('wood_diff.jpg', base).href, 1.5, 1.5),
    loadDataTex(new URL('wood_nor.jpg', base).href, 1.5, 1.5),
    loadDataTex(new URL('wood_rough.jpg', base).href, 1.5, 1.5),
    loadTex(new URL('roof_diff.jpg', base).href, 2, 2),
    loadDataTex(new URL('roof_nor.jpg', base).href, 2, 2)
  ]);

  const matStone = new THREE.MeshStandardMaterial({
    map: cobbleDiff, normalMap: cobbleNor, roughnessMap: cobbleRough,
    roughness: 1, metalness: 0.15, envMapIntensity: 0.8
  });
  // 젖은 느낌: roughness 낮추고 metalness 조금
  matStone.roughness = 0.35;
  matStone.metalness = 0.35;

  const matWood = new THREE.MeshStandardMaterial({
    map: woodDiff, normalMap: woodNor, roughnessMap: woodRough,
    roughness: 1, metalness: 0.05
  });
  const matRoof = new THREE.MeshStandardMaterial({
    map: roofDiff, normalMap: roofNor, roughness: 0.9, metalness: 0.05
  });
  const matGlow = new THREE.MeshBasicMaterial({ color: 0xff6a3c });
  const matWarm = new THREE.MeshBasicMaterial({ color: 0xffe0a8 });
  const matPaper = new THREE.MeshStandardMaterial({ color: 0xf2e6d0, roughness: 0.95 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x2a1a14, roughness: 0.85 });
  const matNoren = new THREE.MeshStandardMaterial({ color: 0xb8322a, roughness: 1 });
  const matNoren2 = new THREE.MeshStandardMaterial({ color: 0x2a4a6e, roughness: 1 });

  function M(geo, m, sx, sy, sz, x, y, z) {
    const o = new THREE.Mesh(geo, m);
    o.scale.set(sx, sy, sz);
    o.position.set(x, y, z);
    return o;
  }

  let markers = [];
  let fujiMesh = null;
  let visited = new Set();
  let curNear = -1;
  let nearLockUntil = 0;
  let nearLockIdx = -1;
  let running = true;
  let raf = 0;

  const player = { pos: new THREE.Vector3(0, 1.55, -32), yaw: 0, pitch: -0.02, bob: 0 };
  const vel = new THREE.Vector3();
  const keys = {};
  const stick = { x: 0, y: 0 };
  let drag = false, lx = 0, ly = 0;

  function clearWorld() {
    while (world.children.length) {
      const o = world.children.pop();
      world.remove(o);
    }
    markers = [];
    fujiMesh = null;
    lightIdx = 0;
    keyLights.forEach(l => { l.intensity = 0; });
  }

  function lantern(parent, x, y, z, s = 1, col = 0xff6a3c) {
    const g = new THREE.Group();
    const body = M(G.cyl6, new THREE.MeshBasicMaterial({ color: col }), 0.28 * s, 0.52 * s, 0.28 * s, 0, 0, 0);
    g.add(body);
    g.add(M(G.cyl, matDark, 0.05 * s, 0.32 * s, 0.05 * s, 0, 0.4 * s, 0));
    g.add(M(G.cyl, matDark, 0.22 * s, 0.05 * s, 0.22 * s, 0, -0.28 * s, 0));
    g.add(M(G.cyl, matDark, 0.22 * s, 0.05 * s, 0.22 * s, 0, 0.28 * s, 0));
    g.add(M(G.sph, new THREE.MeshBasicMaterial({
      color: col, transparent: true, opacity: 0.1, depthWrite: false
    }), 0.5 * s, 0.5 * s, 0.5 * s, 0, 0, 0));
    g.position.set(x, y, z);
    parent.add(g);
  }

  function addShop(side, z, variant = 0) {
    const g = new THREE.Group();
    const w = 3.6 + (variant % 3) * 0.35;
    const d = 5.2;
    const h = 3.9 + (variant % 2) * 0.8;
    const face = -d / 2;

    // 본체 + 기둥
    g.add(M(G.box, matWood, w, h, d, 0, h / 2, 0));
    [-w / 2 + 0.12, w / 2 - 0.12].forEach(px => {
      g.add(M(G.box, matDark, 0.16, h, 0.16, px, h / 2, face + 0.05));
    });

    // 기와 지붕 + 처마
    g.add(M(G.box, matRoof, w + 0.8, 0.75, d + 0.6, 0, h + 0.3, 0));
    g.add(M(G.box, matDark, w + 1.1, 0.1, 0.55, 0, h - 0.02, face - 0.2));
    // 처마 아래 보
    g.add(M(G.box, matWood, w * 0.95, 0.14, 0.14, 0, h - 0.2, face - 0.05));

    // 가게 안 빛
    g.add(M(G.plane, matWarm, w * 0.72, h * 0.4, 1, 0, 1.3, face - 0.02));

    // 격자 미닫이 느낌
    for (let i = 0; i < 3; i++) {
      g.add(M(G.box, matDark, 0.04, h * 0.38, 0.04, -w * 0.28 + i * w * 0.28, 1.3, face - 0.03));
    }

    // 노렌
    const nm = variant % 2 ? matNoren2 : matNoren;
    for (let i = 0; i < 5; i++) {
      g.add(M(G.box, nm, 0.42, 0.95, 0.03, -w * 0.34 + i * 0.42, 2.45, face - 0.08));
    }
    g.add(M(G.cyl, matDark, 0.03, w * 0.88, 0.03, 0, 2.95, face - 0.08));

    // 세로 간판 (판 + 테두리 + 글자 대신 줄무늬)
    const kan = new THREE.Group();
    kan.add(M(G.box, matGlow, 0.38, 2.4, 0.1, 0, 0, 0));
    kan.add(M(G.box, matDark, 0.42, 0.12, 0.12, 0, 1.25, 0));
    kan.add(M(G.box, matDark, 0.42, 0.12, 0.12, 0, -1.25, 0));
    for (let i = 0; i < 4; i++) {
      kan.add(M(G.box, matPaper, 0.22, 0.28, 0.02, 0, 0.75 - i * 0.45, 0.06));
    }
    kan.position.set(w * 0.42, 2.5, face - 0.15);
    g.add(kan);

    // 상품대 + 상자/병 소품
    g.add(M(G.box, matWood, w * 0.55, 0.55, 0.7, 0, 0.28, face - 0.55));
    for (let i = 0; i < 4; i++) {
      g.add(M(G.box, matPaper, 0.25, 0.3, 0.25, -0.55 + i * 0.35, 0.7, face - 0.55));
    }
    g.add(M(G.cyl, matGlow, 0.08, 0.35, 0.08, 0.7, 0.75, face - 0.4));

    // 2층
    if (h > 4.2) {
      [-0.65, 0.65].forEach(wx => {
        g.add(M(G.plane, new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.7 }),
          0.7, 0.85, 1, wx, h - 0.9, face - 0.01));
        g.add(M(G.box, matDark, 0.75, 0.06, 0.06, wx, h - 0.48, face));
      });
      // 난간
      g.add(M(G.box, matDark, w * 0.7, 0.08, 0.08, 0, h - 1.5, face - 0.3));
    }

    // 초롱
    lantern(g, -w * 0.28, 2.85, face - 0.4, 0.95);
    lantern(g, w * 0.28, 2.85, face - 0.4, 0.95);
    if (variant % 3 === 0) lantern(g, 0, 3.3, face - 0.55, 0.75, 0xffb84a);

    g.position.set(side * (5.35 + w / 2), 0, z);
    g.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    world.add(g);
  }

  function addTorii(z, col = 0xc0392b) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: col, roughness: 0.55, metalness: 0.08, emissive: col, emissiveIntensity: 0.1 });
    [-2.35, 2.35].forEach(dx => g.add(M(G.cyl, wood, 0.32, 7.2, 0.32, dx, 3.6, 0)));
    g.add(M(G.box, wood, 7.2, 0.55, 0.7, 0, 7.3, 0));
    g.add(M(G.box, wood, 6.1, 0.38, 0.55, 0, 6.4, 0));
    g.add(M(G.box, matWarm, 0.5, 0.32, 0.75, 0, 7.35, 0));
    // 기초석
    [-2.35, 2.35].forEach(dx => g.add(M(G.box, matStone, 0.7, 0.25, 0.7, dx, 0.12, 0)));
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 28),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.1, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.04;
    g.add(disc);
    g.position.set(0, 0, z);
    world.add(g);
    placeLight(0, 4.8, z + 1.2, col, 3.2);
  }

  function addSpot(stop, i, x, z) {
    const g = new THREE.Group();
    const col = stop.eat ? 0xc0392b : 0xe8734a;
    const m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, emissive: col, emissiveIntensity: 0.3 });
    [-1.05, 1.05].forEach(dx => g.add(M(G.cyl, m, 0.12, 3.1, 0.12, dx, 1.55, 0)));
    g.add(M(G.box, m, 2.9, 0.24, 0.32, 0, 3.2, 0));
    g.add(M(G.box, m, 2.4, 0.16, 0.26, 0, 2.8, 0));
    lantern(g, -1.45, 2.05, 0.3, 0.65);
    lantern(g, 1.45, 2.05, 0.3, 0.65);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.7, 20),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.14, depthWrite: false })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.05;
    g.add(disc);
    g.position.set(x, 0, z);
    g.userData = { idx: i, stop };
    world.add(g);
    markers.push(g);
  }

  function buildStreet(themeKey, stops) {
    clearWorld();
    visited = new Set();
    curNear = -1;
    const T = THEME[themeKey] || THEME.asakusa;
    scene.background = new THREE.Color(T.fog);
    scene.fog = new THREE.FogExp2(T.fog, T.fogDen);
    hemi.intensity = T.amb;
    bloom.strength = T.bloom;
    grade.uniforms.uWarm.value = T.warm;

    const zMin = -36, zMax = 42;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(8.4, zMax - zMin), matStone);
    road.rotation.x = -Math.PI / 2;
    road.position.z = (zMin + zMax) / 2;
    world.add(road);

    // 반사 하이라이트
    for (let i = 0; i < 10; i++) {
      const s = M(G.plane, new THREE.MeshBasicMaterial({
        color: 0xff8a50, transparent: true, opacity: 0.08,
        blending: THREE.AdditiveBlending, depthWrite: false
      }), 0.8 + Math.random(), 3 + Math.random() * 4, 1,
        (Math.random() - 0.5) * 5, 0.03, zMin + Math.random() * (zMax - zMin));
      s.rotation.x = -Math.PI / 2;
      world.add(s);
    }

    [-5.5, 5.5].forEach(x => {
      world.add(M(G.box, matStone, 2.5, 0.14, zMax - zMin, x, 0.07, (zMin + zMax) / 2));
    });

    if (themeKey === 'fuji') {
      for (let z = zMin + 4; z < zMax; z += 8) {
        [-1, 1].forEach(side => {
          world.add(M(G.cyl, new THREE.MeshStandardMaterial({ color: 0x4a3a2a }), 0.2, 2.5, 0.2, side * 6, 1.25, z));
          world.add(M(G.sph, new THREE.MeshStandardMaterial({ color: 0x3f6b4a }), 1.35, 1.15, 1.35, side * 6, 3.1, z));
        });
      }
      const fg = new THREE.Group();
      fg.add(M(G.cone, new THREE.MeshStandardMaterial({ color: 0x4a6285 }), 36, 20, 36, 0, 10, 0));
      fg.add(M(G.cone, new THREE.MeshStandardMaterial({ color: 0xf5f2ea }), 13, 7.5, 13, 0, 17, 0));
      fg.position.set(0, -1, -95);
      world.add(fg);
      fujiMesh = fg;
      placeLight(0, 6, 0, 0xffe8c8, 1.4);
    } else {
      let v = 0;
      for (let z = zMin + 2; z < zMax - 8; z += 4.8) {
        addShop(-1, z, v++);
        addShop(1, z + 0.35, v++);
      }
      addTorii(zMax - 4);
      addTorii(zMin + 4, 0xb03a2e);
      placeLight(-2.2, 3.0, 0, 0xff6a40, 2.2);
      placeLight(2.2, 3.0, 14, 0xff8a50, 2.0);
      placeLight(-2.0, 2.8, -14, 0xffb84a, 1.7);
    }

    // 스팟: 최소 간격 확보 + 스폰은 해당 게이트 바로 앞
    const gap = Math.max(9.5, 54 / Math.max(1, stops.length));
    const z0 = zMin + 8;
    stops.forEach((s, i) => {
      const z = z0 + i * gap;
      const x = (i % 2 === 0 ? -1 : 1) * 1.35;
      addSpot(s, i, x, z);
      // 플레이어는 게이트 앞(같은 x, 약간 -z) — 다음 스팟에 더 가까워지지 않게
      s._walk = { x, z: z - 2.0 };
    });
  }

  function teleportTo(idx) {
    const s = day.stops[idx];
    if (!s?._walk) return;
    player.pos.set(s._walk.x, 1.55, s._walk.z);
    player.yaw = 0;
    player.pitch = -0.02;
    vel.set(0, 0, 0);
    curNear = idx;
    visited.add(idx);
    // 진입 직후 잠깐은 선택 스팟을 유지 (옆 스팟 오인 방지)
    nearLockUntil = performance.now() + 1800;
    nearLockIdx = idx;
    onNear?.(idx, s, visited.size);
  }

  function resize() {
    const w = container.clientWidth || innerWidth;
    const h = container.clientHeight || innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    bloom.setSize(w, h);
  }

  const onKeyDown = e => {
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'Escape') onLeave?.();
  };
  const onKeyUp = e => { keys[e.code] = false; };
  const onDown = e => { if (e.button === 0) { drag = true; lx = e.clientX; ly = e.clientY; } };
  const onUp = () => { drag = false; };
  const onMove = e => {
    if (!drag) return;
    player.yaw -= (e.clientX - lx) * 0.0025;
    player.pitch -= (e.clientY - ly) * 0.002;
    player.pitch = Math.max(-0.6, Math.min(0.4, player.pitch));
    lx = e.clientX; ly = e.clientY;
  };

  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  renderer.domElement.addEventListener('mousedown', onDown);
  addEventListener('mouseup', onUp);
  addEventListener('mousemove', onMove);
  addEventListener('resize', resize);

  const clock = new THREE.Clock();
  let prev = 0;
  function tick() {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const t = clock.getElapsedTime();
    const dt = Math.min(t - prev, 0.05);
    prev = t;

    const run = keys.ShiftLeft || keys.ShiftRight;
    const accel = (run ? 30 : 17) * dt;
    const maxSpd = run ? 10.5 : 5.8;
    let fx = 0, fz = 0;
    if (keys.KeyW || keys.ArrowUp) fz += 1;
    if (keys.KeyS || keys.ArrowDown) fz -= 1;
    if (keys.KeyA || keys.ArrowLeft) fx -= 1;
    if (keys.KeyD || keys.ArrowRight) fx += 1;
    fx += stick.x; fz -= stick.y;
    const len = Math.hypot(fx, fz);
    if (len > 1) { fx /= len; fz /= len; }
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    if (len > 0.05) {
      vel.x += -(fx * cos + fz * sin) * accel;
      vel.z += -(fz * cos - fx * sin) * accel;
    } else {
      vel.x *= Math.pow(0.002, dt);
      vel.z *= Math.pow(0.002, dt);
    }
    const spd = Math.hypot(vel.x, vel.z);
    if (spd > maxSpd) { vel.x = vel.x / spd * maxSpd; vel.z = vel.z / spd * maxSpd; }
    player.pos.x += vel.x * dt;
    player.pos.z += vel.z * dt;
    player.pos.x = Math.max(-3.3, Math.min(3.3, player.pos.x));
    player.pos.z = Math.max(-34, Math.min(40, player.pos.z));
    const moving = spd > 0.3;
    if (moving) player.bob += dt * (run ? 12 : 9);
    player.pos.y = 1.55 + (moving ? Math.sin(player.bob) * 0.03 : 0);
    camera.position.copy(player.pos);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;

    let near = -1, nd = 1e9;
    if (performance.now() < nearLockUntil && nearLockIdx >= 0) {
      near = nearLockIdx;
      nd = 0;
    } else {
      markers.forEach((m, i) => {
        const d = Math.hypot(m.position.x - player.pos.x, m.position.z - player.pos.z);
        if (d < nd) { nd = d; near = i; }
      });
    }
    if (nd < 3.8 && near >= 0) {
      if (curNear !== near) {
        curNear = near;
        visited.add(near);
        onNear?.(near, day.stops[near], visited.size);
      }
    } else if (nd > 5.5 && curNear !== -1 && performance.now() >= nearLockUntil) {
      curNear = -1;
      onNear?.(null, null, visited.size);
    }
    if (fujiMesh) fujiMesh.rotation.y = Math.sin(t * 0.04) * 0.03;
    composer.render();
  }

  buildStreet(day.theme, day.stops);
  teleportTo(startIdx);
  resize();
  tick();

  return {
    setStick(x, y) { stick.x = x; stick.y = y; },
    goToStop(idx) { teleportTo(idx); },
    resize,
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      removeEventListener('keydown', onKeyDown);
      removeEventListener('keyup', onKeyUp);
      removeEventListener('mouseup', onUp);
      removeEventListener('mousemove', onMove);
      removeEventListener('resize', resize);
      [cobbleDiff, cobbleNor, cobbleRough, woodDiff, woodNor, woodRough, roofDiff, roofNor].forEach(t => t.dispose());
      clearWorld();
      renderer.dispose();
      renderer.domElement.remove();
    }
  };
}
