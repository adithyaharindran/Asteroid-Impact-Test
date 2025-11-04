const diameterSlider = document.getElementById('diameterSlider');
const velocitySlider = document.getElementById('velocitySlider');
const angleSlider = document.getElementById('angleSlider');
const densitySlider = document.getElementById('densitySlider');

const diameterValue = document.getElementById('diameterValue');
const velocityValue = document.getElementById('velocityValue');
const angleValue = document.getElementById('angleValue');
const densityValue = document.getElementById('densityValue');

[diameterSlider, velocitySlider, angleSlider, densitySlider].forEach(slider => slider.addEventListener('input', updateUI));

function updateUI() {
  diameterValue.textContent = diameterSlider.value;
  velocityValue.textContent = velocitySlider.value;
  angleValue.textContent = angleSlider.value;
  densityValue.textContent = densitySlider.value;
}

let scene, camera, renderer, controls;
let earth, asteroidMesh;
const earthRadius = 6.371;

let asteroidTargetUnitVec = null;
let isAnimatingImpact = false;
let impactAnimationStart = 0;
const impactAnimationDuration = 3000;

let impactCraterMesh = null;
let craterRadius_km = 1;
let orbitTime = 0;

function initThree() {
  const threeContainer = document.getElementById('threeContainer');
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(60, threeContainer.clientWidth / threeContainer.clientHeight, 0.1, 1000);
  camera.position.set(22, 22, 28);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
  threeContainer.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;

  // Load Earth texture
  const loader = new THREE.TextureLoader();
  const earthTexture = loader.load('earth_daymap.jpg');
  const earthMaterial = new THREE.MeshPhongMaterial({ map: earthTexture });
  earth = new THREE.Mesh(new THREE.SphereGeometry(earthRadius, 64, 64), earthMaterial);
  scene.add(earth);

  scene.add(new THREE.AmbientLight(0x333333));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(100, 50, 80);
  scene.add(dirLight);

  const asteroidGeom = new THREE.SphereGeometry(0.5, 18, 18);
  const asteroidMat = new THREE.MeshPhongMaterial({ color: 0xff3300 });
  asteroidMesh = new THREE.Mesh(asteroidGeom, asteroidMat);
  asteroidMesh.position.copy(new THREE.Vector3(-earthRadius * 2, 0, 0));
  scene.add(asteroidMesh);

  animate();
}

function latLonToVector3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

function slerp(v1, v2, t) {
  let dot = v1.dot(v2);
  dot = Math.min(Math.max(dot, -1), 1);
  const theta = Math.acos(dot) * t;
  const relativeVec = v2.clone().sub(v1.clone().multiplyScalar(dot)).normalize();
  const part1 = v1.clone().multiplyScalar(Math.cos(theta));
  const part2 = relativeVec.clone().multiplyScalar(Math.sin(theta));
  return part1.add(part2);
}

function animateImpactSpherical(timestamp) {
  if (!impactAnimationStart) impactAnimationStart = timestamp;
  const elapsed = timestamp - impactAnimationStart;
  const t = Math.min(elapsed / impactAnimationDuration, 1);
  const leftUnitVec = new THREE.Vector3(-1, 0, 0);
  const interpUnitPos = slerp(leftUnitVec, asteroidTargetUnitVec, t);
  asteroidMesh.position.copy(interpUnitPos.multiplyScalar(earthRadius));
  if (t >= 1) {
    isAnimatingImpact = false;
    impactAnimationStart = 0;
    createImpactCrater(asteroidMesh.position, craterRadius_km);
    updateSimulation();
    orbitTime = 0;
    asteroidMesh.position.copy(new THREE.Vector3(-earthRadius * 2, 0, 0));
    asteroidMesh.scale.set(1, 1, 1);
  } else {
    requestAnimationFrame(animateImpactSpherical);
  }
}

function createImpactCrater(position, craterRadius) {
  if (impactCraterMesh) {
    scene.remove(impactCraterMesh);
    impactCraterMesh.geometry.dispose();
    impactCraterMesh.material.dispose();
  }
  const geometry = new THREE.CircleGeometry(0.01, 64);
  const material = new THREE.MeshBasicMaterial({
    color: 0xff4500,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.7,
  });
  impactCraterMesh = new THREE.Mesh(geometry, material);
  impactCraterMesh.position.copy(position);
  const normal = position.clone().normalize();
  impactCraterMesh.lookAt(position.clone().add(normal));
  impactCraterMesh.scale.set(0.01, 0.01, 0.01);
  scene.add(impactCraterMesh);
  const startTime = performance.now();
  const duration = 1500;
  function expandCrater(time) {
    const elapsed = time - startTime;
    const scale = Math.min(elapsed / duration, 1) * craterRadius * 0.3;
    impactCraterMesh.scale.set(scale, scale, scale);
    if (elapsed < duration) requestAnimationFrame(expandCrater);
  }
  requestAnimationFrame(expandCrater);
}

function animateOrbit() {
  const orbitRadius = earthRadius * 2;
  const orbitSpeed = 0.01;
  orbitTime += orbitSpeed;
  if (orbitTime > Math.PI * 2) orbitTime -= Math.PI * 2;
  const x = orbitRadius * Math.cos(orbitTime);
  const z = orbitRadius * Math.sin(orbitTime);
  const y = 0;
  if (!isAnimatingImpact) asteroidMesh.position.set(x, y, z);
}

function kineticEnergy(vel, mass) {
  return 0.5 * mass * vel * vel;
}

function estimateFatalities(energyMt, popDensity, impactRadius) {
  const destroyedRadius = Math.log10(energyMt + 1) * 10;
  const affectedArea = Math.PI * destroyedRadius * destroyedRadius;
  const exposedPopulation = popDensity * affectedArea;
  return Math.round(exposedPopulation * 0.6);
}

function estimateTsunami(energyMt, distanceKm) {
  const H = (energyMt / (distanceKm + 20)) * 2;
  return Math.max(0, Math.round(H * 10) / 10);
}

const worldAvgPopDensity = 60;

let map, impactMarker = null, shockwaveCircle = null;

function createShockwave(latlng, impactRadiusKms) {
  if (shockwaveCircle) map.removeLayer(shockwaveCircle);
  let radius = 0;
  shockwaveCircle = L.circle(latlng, {
    radius: radius,
    color: "rgba(255, 69, 0, 0.8)",
    fillColor: "rgba(255, 69, 0, 0.3)",
    fillOpacity: 0.3,
    weight: 3,
    opacity: 0.8,
  }).addTo(map);

  const maxRadius = impactRadiusKms * 1000 * 5;
  const duration = 3000;
  const startTime = Date.now();

  function animateShockwave() {
    const elapsed = Date.now() - startTime;
    if (elapsed < duration) {
      radius = (elapsed / duration) * maxRadius;
      const opacity = 0.8 * (1 - elapsed / duration);
      shockwaveCircle.setRadius(radius);
      shockwaveCircle.setStyle({
        color: `rgba(255,69,0,${opacity})`,
        fillOpacity: 0.3 * (1 - elapsed / duration),
      });
      requestAnimationFrame(animateShockwave);
    } else {
      map.removeLayer(shockwaveCircle);
      shockwaveCircle = null;
    }
  }
  animateShockwave();
}

function initMap() {
  map = L.map("map").setView([20, 0], 2);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  map.on("click", function (e) {
    if (impactMarker) map.removeLayer(impactMarker);
    impactMarker = L.marker(e.latlng).addTo(map);

    let impactDiameter = Number(diameterSlider.value);
    let velocity = Number(velocitySlider.value);
    let density = Number(densitySlider.value);

    const r = impactDiameter / 2;
    const volume = (4 / 3) * Math.PI * Math.pow(r, 3);
    const mass = volume * density;
    const vel_ms = velocity * 1000;
    const energy_joules = kineticEnergy(vel_ms, mass);
    const energy_megatons = energy_joules / 4.184e15;
    const craterDiameter_m = Math.pow(energy_joules / 1e6, 0.294) * 1.8;
    craterRadius_km = Math.max(0.01, craterDiameter_m / 2000);

    asteroidTargetUnitVec = latLonToVector3(e.latlng.lat, e.latlng.lng, 1).normalize();
    let impactScale = Math.max(impactDiameter / 1000, 0.5);
    asteroidMesh.scale.set(impactScale, impactScale, impactScale);

    isAnimatingImpact = true;
    impactAnimationStart = 0;

    requestAnimationFrame(animateImpactSpherical);
    createShockwave(e.latlng, craterRadius_km);
  });
}

window.addEventListener("resize", () => {
  const threeContainer = document.getElementById("threeContainer");
  if (camera && renderer) {
    camera.aspect = threeContainer.clientWidth / threeContainer.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
  }
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (!isAnimatingImpact) animateOrbit();
  renderer.render(scene, camera);
}

window.addEventListener("DOMContentLoaded", () => {
  initThree();
  initMap();
  updateUI();
});

function updateSimulation() {
  const D = Number(diameterSlider.value);
  const V = Number(velocitySlider.value);
  const A = Number(angleSlider.value);
  const RHO = Number(densitySlider.value);
  const r = D / 2;
  const volume = (4 / 3) * Math.PI * Math.pow(r, 3);
  const mass = volume * RHO;
  const vel_ms = V * 1000;
  const energy_joules = kineticEnergy(vel_ms, mass);
  const energy_megatons = energy_joules / 4.184e15;
  const craterDiameter_m = Math.pow(energy_joules / 1e6, 0.294) * 1.8;
  craterRadius_km = Math.max(0.01, craterDiameter_m / 2000);

  let impactLat = 0,
      impactLon = 0;
  if (impactMarker) {
    impactLat = impactMarker.getLatLng().lat;
    impactLon = impactMarker.getLatLng().lng;
  }
  let tsunamiHeight = estimateTsunami(energy_megatons, 300);
  let fatalities = estimateFatalities(energy_megatons, worldAvgPopDensity, craterRadius_km);

  document.getElementById("dataPanel").innerHTML = `
      <b>Impact Energy:</b> ${energy_megatons.toLocaleString(undefined, { maximumFractionDigits: 2 })} Mt TNT<br>
      <b>Crater Diameter:</b> ${(craterRadius_km * 2).toLocaleString(undefined, { maximumFractionDigits: 2 })} km<br>
      <b>Estimated Fatalities:</b> ${fatalities.toLocaleString()}<br>
      <b>Tsunami Hazard:</b> ${tsunamiHeight ? tsunamiHeight + " m run-up" : "Low"}<br>
      <b>Location:</b> ${impactLat.toFixed(3)}, ${impactLon.toFixed(3)}<br>
      <b>Asteroid Mass:</b> ${mass.toExponential(2)} kg
    `;
}
