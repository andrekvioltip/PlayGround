import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';

const container = document.querySelector('#game');
const scene = new THREE.Scene();
const sky = new THREE.Color('#a9d8ed');
scene.background = sky;
scene.fog = new THREE.Fog('#a9d8ed', 23, 58);
const camera = new THREE.PerspectiveCamera(73, innerWidth / innerHeight, .08, 100);
camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
container.appendChild(renderer.domElement);

const controls = new PointerLockControls(camera, document.body);
const ambient = new THREE.HemisphereLight('#e7f8ff', '#667743', 1.75);
scene.add(ambient);
const sunlight = new THREE.DirectionalLight('#fff0cb', 2.4);
sunlight.position.set(-18, 30, -14);
scene.add(sunlight);

const BLOCKS = {
  grass: { name: 'Meadow grass', color: '#78a94e', top: '#82b85a', side: '#78994b' },
  dirt: { name: 'Earth', color: '#946a46' },
  stone: { name: 'Stone', color: '#8e9690' },
  log: { name: 'Oak log', color: '#9b7045', top: '#c19a62' },
  leaves: { name: 'Oak leaves', color: '#58844c' },
  sand: { name: 'Sand', color: '#d8c486' },
  plank: { name: 'Timber planks', color: '#c29355' },
  brick: { name: 'Terracotta', color: '#b86d51' }
};
const order = Object.keys(BLOCKS);
const inventory = { grass: 0, dirt: 12, stone: 18, log: 8, leaves: 0, sand: 0, plank: 12, brick: 8 };
let selected = 0;
let blockMeshes = [];
let meshLookup = new Map();
let world = new Map();
let terrainHeight = new Map();
let changed = new Map();
let hasStarted = false;
let muted = true;
let audioContext = null;
let toastTimer;
let toastCount = 0;
let health = 10;
let energy = 10;
let jumpVelocity = 0;
let onGround = false;
let elapsed = 0;
let breakCount = 0;
let buildCount = 0;
let lastInteraction = 0;
const keys = new Set();
const held = new Set();
const worldRadius = 24;
const walkSpeed = 4.65;
const playerHeight = 1.67;
const raycaster = new THREE.Raycaster();
raycaster.far = 6.2;
raycaster.params.Mesh = { threshold: 0 };
const targetOutline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.012, 1.012, 1.012)), new THREE.LineBasicMaterial({ color: '#fff3a7', transparent: true, opacity: .9, depthTest: false }));
targetOutline.visible = false;
targetOutline.renderOrder = 20;
scene.add(targetOutline);
const particles = [];
const particleGeometry = new THREE.BoxGeometry(.12, .12, .12);
const clock = new THREE.Clock();

function key(x, y, z) { return `${x},${y},${z}`; }
function setBlock(x, y, z, type) {
  const k = key(x, y, z);
  if (type) world.set(k, { x, y, z, type }); else world.delete(k);
}
function getBlock(x, y, z) { return world.get(key(x, y, z)); }
function makeTexture(base, seed) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const ctx = c.getContext('2d'); ctx.fillStyle = base; ctx.fillRect(0, 0, 16, 16);
  let s = seed >>> 0;
  const rnd = () => { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < 62; i++) {
    const light = rnd() > .52; const size = rnd() > .84 ? 2 : 1;
    ctx.fillStyle = light ? 'rgba(255,255,220,.13)' : 'rgba(30,35,25,.13)';
    ctx.fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), size, size);
  }
  const texture = new THREE.CanvasTexture(c); texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.NearestFilter; texture.colorSpace = THREE.SRGBColorSpace; return texture;
}
function mat(color, seed) { return new THREE.MeshStandardMaterial({ map: makeTexture(color, seed), roughness: 1, metalness: 0 }); }
const materials = {};
for (const [i, type] of order.entries()) {
  const b = BLOCKS[type];
  if (type === 'grass') materials[type] = [mat(b.side, 10), mat(b.side, 11), mat(b.top, 12), mat('#758d4a', 13), mat(b.side, 14), mat(b.side, 15)];
  else if (type === 'log') materials[type] = [mat(b.color, 30), mat(b.color, 31), mat(b.top, 32), mat(b.top, 33), mat(b.color, 34), mat(b.color, 35)];
  else materials[type] = mat(b.color, i + 41);
}
const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
const dummy = new THREE.Object3D();

function heightAt(x, z) {
  const clearing = Math.max(0, 1 - Math.hypot(x + 1, z - 1) / 11);
  const waves = Math.sin(x * .27) * 1.1 + Math.cos(z * .23) * 1.1 + Math.sin((x + z) * .16) * 1.2 + Math.cos((x - z) * .11) * .8;
  return Math.max(2, Math.min(8, Math.floor(4.5 + waves - clearing * 1.7)));
}
function addTree(x, z, baseY, size = 1) {
  const trunk = 3 + (size > 1 ? 1 : 0);
  for (let y = 0; y < trunk; y++) setBlock(x, baseY + y, z, 'log');
  for (let dy = trunk - 2; dy <= trunk + 1; dy++) {
    const radius = dy === trunk + 1 ? 1 : (dy === trunk - 2 ? 1 : 2);
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      if (Math.abs(dx) === radius && Math.abs(dz) === radius && Math.random() > .42) continue;
      if (!getBlock(x + dx, baseY + dy, z + dz)) setBlock(x + dx, baseY + dy, z + dz, 'leaves');
    }
  }
}
function loadWorld() {
  world.clear(); terrainHeight.clear(); changed.clear();
  for (let x = -worldRadius; x <= worldRadius; x++) for (let z = -worldRadius; z <= worldRadius; z++) {
    const h = heightAt(x, z); terrainHeight.set(`${x},${z}`, h);
    for (let y = 0; y <= h; y++) {
      let type = y === 0 ? 'stone' : y === h ? 'grass' : y >= h - 2 ? 'dirt' : 'stone';
      if (h <= 2 && y === h) type = 'sand';
      setBlock(x, y, z, type);
    }
  }
  let seed = 98431;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 112; i++) {
    const x = Math.floor(rand() * 45) - 22, z = Math.floor(rand() * 45) - 22;
    if (Math.hypot(x + 1, z - 1) < 7) continue;
    const h = terrainHeight.get(`${x},${z}`) ?? 4;
    if (h > 2 && rand() > .19 && !getBlock(x, h + 1, z)) addTree(x, z, h + 1, rand() > .8 ? 2 : 1);
  }
  try {
    const saved = JSON.parse(localStorage.getItem('blockbound-world') || '{}');
    for (const [k, item] of Object.entries(saved.blocks || {})) {
      const [x,y,z] = k.split(',').map(Number);
      setBlock(x,y,z,item);
      changed.set(k,item);
    }
    Object.assign(inventory, saved.inventory || {});
    breakCount = saved.breakCount || 0; buildCount = saved.buildCount || 0;
  } catch (e) { console.info('Starting a new frontier.'); }
  rebuildMeshes();
}
function saveWorld() {
  try { localStorage.setItem('blockbound-world', JSON.stringify({ blocks: Object.fromEntries(changed), inventory, breakCount, buildCount })); } catch (e) { /* storage is optional */ }
}
function rebuildMeshes() {
  for (const mesh of blockMeshes) { scene.remove(mesh); mesh.dispose?.(); }
  blockMeshes = []; meshLookup.clear();
  const groups = new Map(order.map(type => [type, []]));
  for (const block of world.values()) if (groups.has(block.type)) groups.get(block.type).push(block);
  for (const type of order) {
    const list = groups.get(type); if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(cubeGeometry, materials[type], list.length);
    mesh.name = `blocks-${type}`; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.userData.blockKeys = list.map(b => key(b.x, b.y, b.z));
    list.forEach((b, i) => { dummy.position.set(b.x + .5, b.y + .5, b.z + .5); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere();
    scene.add(mesh); blockMeshes.push(mesh); meshLookup.set(type, mesh);
  }
}

const waterMaterial = new THREE.MeshStandardMaterial({ color: '#72c7c7', transparent: true, opacity: .58, roughness: .28, metalness: .02, depthWrite: false });
const water = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), waterMaterial); water.rotation.x = -Math.PI / 2; water.position.y = 2.03; water.renderOrder = 2; scene.add(water);
function addCloud(x, y, z, scale) {
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#f5f4e3', transparent: true, opacity: .76 });
  const group = new THREE.Group();
  for (const [dx,dy,dz,s] of [[0,0,0,1.3],[1.1,.1,0,1],[2,0,.1,.8],[-.9,-.05,0,.8]]) {
    const part = new THREE.Mesh(new THREE.BoxGeometry(s * 1.6, .35 * s, .65 * s), cloudMat); part.position.set(dx,dy,dz); group.add(part);
  }
  group.position.set(x,y,z); group.scale.setScalar(scale); scene.add(group);
}
addCloud(-17, 15, -28, 1.4); addCloud(18, 18, -34, 1.8); addCloud(32, 13, 1, 1.25);
loadWorld();
const spawnHeight = terrainHeight.get('0,0') ?? 4;
camera.position.set(.5, spawnHeight + playerHeight + 1.12, .5);
camera.rotation.set(-.04, Math.PI * .07, 0);

function createInterface() {
  const hotbar = document.querySelector('#hotbar');
  hotbar.innerHTML = '';
  order.forEach((type, i) => {
    const slot = document.createElement('button'); slot.className = `slot${i === selected ? ' selected' : ''}`; slot.dataset.index = i; slot.setAttribute('aria-label', `${i + 1}: ${BLOCKS[type].name}`);
    slot.innerHTML = `<span class="slot-key">${i + 1}</span><span class="block-icon" style="background:${BLOCKS[type].top || BLOCKS[type].color}"></span><span class="count" id="count-${type}">${inventory[type]}</span>`;
    slot.addEventListener('click', () => selectSlot(i)); hotbar.appendChild(slot);
  });
  const hearts = document.querySelector('#hearts'); hearts.innerHTML = Array.from({length:10}, (_,i) => `<span class="heart${i >= health ? ' empty' : ''}">♥</span>`).join('');
  const food = document.querySelector('#food-pips'); food.innerHTML = Array.from({length:10}, (_,i) => `<span class="food-pip${i >= energy ? ' empty' : ''}"></span>`).join('');
}
function selectSlot(index) {
  selected = (index + order.length) % order.length;
  document.querySelectorAll('.slot').forEach((el,i) => el.classList.toggle('selected', i === selected));
  const type = order[selected]; showToast(`${BLOCKS[type].name} selected`);
}
function updateInventory(type, amount) {
  inventory[type] = Math.max(0, (inventory[type] || 0) + amount);
  const count = document.querySelector(`#count-${type}`); if (count) count.textContent = inventory[type];
  saveWorld();
}
function showToast(message) {
  const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}
function sound(frequency = 180, duration = .07, type = 'sine') {
  if (muted) return;
  try {
    audioContext ||= new AudioContext(); const osc = audioContext.createOscillator(), gain = audioContext.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, audioContext.currentTime); osc.frequency.exponentialRampToValueAtTime(Math.max(45, frequency * .58), audioContext.currentTime + duration);
    gain.gain.setValueAtTime(.055, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + duration);
    osc.connect(gain); gain.connect(audioContext.destination); osc.start(); osc.stop(audioContext.currentTime + duration);
  } catch {}
}
function updateObjective() {
  const title = document.querySelector('#objective-title'), copy = document.querySelector('#objective-copy');
  if (buildCount > 0) { title.textContent = 'The first foundations'; copy.textContent = `${buildCount} block${buildCount === 1 ? '' : 's'} placed · keep shaping your home.`; }
  else if (breakCount > 0) { title.textContent = 'A little gathering'; copy.textContent = `${breakCount} block${breakCount === 1 ? '' : 's'} collected · maybe build something?`; }
  else { title.textContent = 'A world of your own'; copy.textContent = 'Gather, build, and make it yours.'; }
}
function playParticles(block) {
  const material = new THREE.MeshStandardMaterial({ color: BLOCKS[block.type]?.top || BLOCKS[block.type]?.color || '#8e9069', roughness: 1 });
  for (let i=0;i<7;i++) {
    const mesh = new THREE.Mesh(particleGeometry, material); mesh.position.set(block.x + .2 + Math.random()*.6, block.y + .3 + Math.random()*.6, block.z + .2 + Math.random()*.6);
    mesh.userData.velocity = new THREE.Vector3((Math.random()-.5)*2, Math.random()*2, (Math.random()-.5)*2); mesh.userData.life = .45 + Math.random()*.3;
    scene.add(mesh); particles.push(mesh);
  }
}
function getTarget() {
  raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
  const hit = raycaster.intersectObjects(blockMeshes, false)[0];
  if (!hit || hit.instanceId === undefined) return null;
  const k = hit.object.userData.blockKeys[hit.instanceId]; const block = world.get(k); if (!block) return null;
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).round();
  return { block, normal, point: hit.point };
}
function breakBlock() {
  const hit = getTarget(); if (!hit || hit.block.y === 0) { if (hit?.block.y === 0) showToast('This stone runs deep.'); return; }
  const b = hit.block; setBlock(b.x,b.y,b.z,null); changed.set(key(b.x,b.y,b.z), null);
  updateInventory(b.type, 1); rebuildMeshes(); playParticles(b); breakCount++; updateObjective(); saveWorld(); sound(165, .11, 'square');
}
function overlapsPlayer(x,y,z) {
  const p = camera.position, feet = p.y - playerHeight, head = p.y + .05;
  return p.x + .29 > x && p.x - .29 < x+1 && p.z + .29 > z && p.z - .29 < z+1 && head > y && feet < y+1;
}
function placeBlock() {
  const hit = getTarget(); if (!hit) return;
  const { block, normal } = hit; const x = block.x + normal.x, y = block.y + normal.y, z = block.z + normal.z; const type = order[selected];
  if (y < 1 || Math.abs(x) > worldRadius || Math.abs(z) > worldRadius || getBlock(x,y,z) || overlapsPlayer(x,y,z)) { showToast('No room for a block there.'); return; }
  if (inventory[type] <= 0) { showToast(`No ${BLOCKS[type].name.toLowerCase()} left.`); return; }
  setBlock(x,y,z,type); changed.set(key(x,y,z), type); updateInventory(type,-1); rebuildMeshes(); buildCount++; updateObjective(); saveWorld(); sound(235, .09, 'triangle');
}
function collideAt(x, y, z) {
  const feet = y - playerHeight, head = y + .02;
  const corners = [[x-.27,z-.27],[x+.27,z-.27],[x-.27,z+.27],[x+.27,z+.27]];
  for (const [cx,cz] of corners) for (let by = Math.floor(feet + .05); by <= Math.floor(head); by++) if (getBlock(Math.floor(cx),by,Math.floor(cz))) return true;
  return false;
}
function floorAt(x,z, feet) {
  let highest = -100;
  for (const [cx,cz] of [[x-.25,z-.25],[x+.25,z-.25],[x-.25,z+.25],[x+.25,z+.25]]) {
    for (let y = Math.floor(feet) + 1; y >= Math.floor(feet)-1; y--) if (getBlock(Math.floor(cx),y,Math.floor(cz)) && y+1 <= feet + .42) highest = Math.max(highest,y+1);
  }
  return highest;
}
function updateMovement(dt) {
  const moving = keys.has('KeyW') || keys.has('ArrowUp') || keys.has('KeyS') || keys.has('ArrowDown') || keys.has('KeyA') || keys.has('ArrowLeft') || keys.has('KeyD') || keys.has('ArrowRight') || held.size > 0;
  let forward = (keys.has('KeyW') || keys.has('ArrowUp') || held.has('forward') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') || held.has('back') ? 1 : 0);
  let side = (keys.has('KeyD') || keys.has('ArrowRight') || held.has('right') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') || held.has('left') ? 1 : 0);
  if (forward || side) {
    const length = Math.hypot(forward, side); forward /= length; side /= length;
    const speed = walkSpeed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1.45 : 1);
    const yaw = camera.rotation.y;
    const dx = (Math.sin(yaw) * forward + Math.cos(yaw) * side) * speed * dt;
    const dz = (-Math.cos(yaw) * forward + Math.sin(yaw) * side) * speed * dt;
    let nx = THREE.MathUtils.clamp(camera.position.x + dx, -worldRadius + .35, worldRadius - .35);
    let nz = THREE.MathUtils.clamp(camera.position.z + dz, -worldRadius + .35, worldRadius - .35);
    let step = floorAt(nx,nz,camera.position.y-playerHeight);
    if (step > camera.position.y-playerHeight && step <= camera.position.y-playerHeight + 1.05) camera.position.y = step + playerHeight;
    if (!collideAt(nx,camera.position.y,nz)) { camera.position.x = nx; camera.position.z = nz; }
    else {
      if (!collideAt(nx,camera.position.y,camera.position.z)) camera.position.x = nx;
      if (!collideAt(camera.position.x,camera.position.y,nz)) camera.position.z = nz;
    }
    const steppedFloor = floorAt(camera.position.x,camera.position.z,camera.position.y-playerHeight);
    if (steppedFloor > camera.position.y-playerHeight && steppedFloor <= camera.position.y-playerHeight + 1.05) camera.position.y = steppedFloor + playerHeight;
  }
  const feet = camera.position.y - playerHeight;
  const floor = floorAt(camera.position.x,camera.position.z,feet);
  if (floor > -50 && feet <= floor + .42 && feet >= floor - .05 && jumpVelocity <= 0) { camera.position.y = floor + playerHeight; jumpVelocity = 0; onGround = true; }
  else onGround = false;
  if ((keys.has('Space') || held.has('jump')) && onGround && !keys.has('SpaceConsumed')) { jumpVelocity = 7.2; onGround = false; keys.add('SpaceConsumed'); sound(310,.08,'sine'); }
  if (!keys.has('Space') && !held.has('jump')) keys.delete('SpaceConsumed');
  jumpVelocity -= 20 * dt; camera.position.y += jumpVelocity * dt;
  if (camera.position.y < playerHeight + 1) { camera.position.y = playerHeight + 1; jumpVelocity = 0; }
  if (moving && elapsed % 6 < dt && !muted) sound(85, .035, 'triangle');
}
function updateTarget() {
  const hit = getTarget(), label = document.querySelector('#target-label');
  if (hit && hasStarted && pause.classList.contains('hidden') && help.classList.contains('hidden')) {
    targetOutline.position.set(hit.block.x+.5,hit.block.y+.5,hit.block.z+.5); targetOutline.visible = true;
    label.textContent = `${BLOCKS[hit.block.type].name.toUpperCase()}  ·  LMB MINE`; label.classList.add('visible');
  } else { targetOutline.visible = false; label.classList.remove('visible'); }
}

createInterface();
const welcome = document.querySelector('#welcome-screen');
const pause = document.querySelector('#pause-screen');
const help = document.querySelector('#help-screen');
let helpOpen = false;
let pointerWasLocked = false;
const coarsePointer = matchMedia('(pointer:coarse)').matches;
function beginGame() {
  hasStarted = true;
  welcome.classList.add('hidden');
  if (!coarsePointer) controls.lock();
  else showToast('Use the touch controls to explore.');
}
function showPause() { pause.classList.remove('hidden'); }
function resumeGame() {
  pause.classList.add('hidden'); helpOpen = false;
  if (!coarsePointer) controls.lock();
}
controls.addEventListener('lock', () => {
  pointerWasLocked = true; pause.classList.add('hidden'); welcome.classList.add('hidden');
});
controls.addEventListener('unlock', () => {
  if (!pointerWasLocked) return;
  pointerWasLocked = false;
  if (hasStarted && !helpOpen && !coarsePointer && welcome.classList.contains('hidden')) showPause();
});
document.querySelector('#play-button').addEventListener('click', beginGame);
document.querySelector('#resume-button').addEventListener('click', resumeGame);
document.querySelector('#pause-button').addEventListener('click', () => {
  if (controls.isLocked) controls.unlock(); else if (hasStarted) showPause();
});
document.querySelector('#reset-button').addEventListener('click', () => {
  localStorage.removeItem('blockbound-world'); location.reload();
});
document.querySelector('#help-trigger').addEventListener('click', () => {
  helpOpen = true; if (controls.isLocked) controls.unlock(); pause.classList.add('hidden'); help.classList.remove('hidden');
});
function closeHelp() { help.classList.add('hidden'); helpOpen = false; if (hasStarted && !coarsePointer) controls.lock(); }
document.querySelector('#close-help').addEventListener('click', closeHelp);
document.querySelector('#got-it').addEventListener('click', closeHelp);
document.querySelector('#sound-toggle').addEventListener('click', event => {
  muted = !muted; event.currentTarget.textContent = muted ? '♫' : '♪'; event.currentTarget.style.background = muted ? '' : '#f6d47f';
  showToast(muted ? 'Sounds off' : 'Sounds on'); if (!muted) sound(420,.08);
});

renderer.domElement.addEventListener('click', () => { if (hasStarted && !coarsePointer && !controls.isLocked && pause.classList.contains('hidden')) controls.lock(); });
document.addEventListener('keydown', event => {
  if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (/^Digit[1-8]$/.test(event.code)) selectSlot(Number(event.code.slice(-1))-1);
  if (event.code === 'Escape' && hasStarted && !helpOpen && !coarsePointer) {
    if (controls.isLocked) controls.unlock(); else if (!pause.classList.contains('hidden')) resumeGame();
  }
  if (event.code === 'KeyE' && hasStarted) { helpOpen ? closeHelp() : document.querySelector('#help-trigger').click(); }
});
document.addEventListener('keyup', event => keys.delete(event.code));
document.addEventListener('mousedown', event => {
  if (!hasStarted || helpOpen || !pause.classList.contains('hidden')) return;
  if (!controls.isLocked && event.target !== renderer.domElement) return;
  if (event.button === 0) breakBlock();
  if (event.button === 2) { event.preventDefault(); placeBlock(); }
});
document.addEventListener('contextmenu', event => event.preventDefault());

for (const button of document.querySelectorAll('[data-move]')) {
  const action = button.dataset.move;
  button.addEventListener('pointerdown', event => { event.preventDefault(); held.add(action); button.setPointerCapture?.(event.pointerId); });
  for (const name of ['pointerup','pointercancel','lostpointercapture']) button.addEventListener(name, () => held.delete(action));
}
document.querySelector('#mobile-break').addEventListener('pointerdown', event => { event.preventDefault(); breakBlock(); });
document.querySelector('#mobile-place').addEventListener('pointerdown', event => { event.preventDefault(); placeBlock(); });
let lookPointer = null, lastLookX = 0, lastLookY = 0;
renderer.domElement.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' && hasStarted) { lookPointer = event.pointerId; lastLookX = event.clientX; lastLookY = event.clientY; renderer.domElement.setPointerCapture(event.pointerId); }
});
renderer.domElement.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch' && event.pointerId === lookPointer) {
    const dx = event.clientX - lastLookX, dy = event.clientY - lastLookY; lastLookX = event.clientX; lastLookY = event.clientY;
    camera.rotation.y -= dx * .005; camera.rotation.x = THREE.MathUtils.clamp(camera.rotation.x - dy * .004, -1.35, 1.35);
  }
});
renderer.domElement.addEventListener('pointerup', event => { if (event.pointerId === lookPointer) lookPointer = null; });

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), .04); elapsed += dt;
  if (hasStarted && pause.classList.contains('hidden') && help.classList.contains('hidden')) {
    updateMovement(dt);
    if (Date.now() - lastInteraction > 120) { updateTarget(); lastInteraction = Date.now(); }
    for (let i=particles.length-1;i>=0;i--) {
      const p=particles[i]; p.userData.life-=dt; p.userData.velocity.y-=8*dt; p.position.addScaledVector(p.userData.velocity,dt); p.rotation.x+=dt*3; p.rotation.y+=dt*2;
      if (p.userData.life<=0) { scene.remove(p); p.material.dispose(); particles.splice(i,1); }
    }
    if (elapsed % .1 < dt) document.querySelector('#coords').textContent = `X ${Math.floor(camera.position.x)} · Y ${Math.floor(camera.position.y)} · Z ${Math.floor(camera.position.z)}`;
  }
  renderer.render(scene,camera);
}
animate();
window.addEventListener('resize', () => { camera.aspect=innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });
window.addEventListener('beforeunload', saveWorld);
