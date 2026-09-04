import * as THREE from 'three';
import { SVGLoader } from './vendor/SVGLoader.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { defaultArtworkSvg } from './default-artwork.js';

const sampleSvg = defaultArtworkSvg;

const ui = Object.fromEntries([
  'svgInput', 'fileName', 'fileMeta', 'sampleButton', 'archHeight', 'archHeightValue',
  'bridgeWidth', 'bridgeWidthValue', 'modelThickness', 'modelThicknessValue',
  'modelWidth', 'modelWidthValue', 'autoConnections', 'autoConnectionsValue',
  'suggestButton', 'suggestionText', 'undoButton',
  'exportButton', 'addModeButton', 'inspectModeButton', 'zoomInButton', 'zoomOutButton',
  'resetViewButton', 'zoomLabel', 'statusText', 'connectionList', 'noConnections',
  'bridgeCountBadge', 'pieceCount', 'bridgeCount', 'floatingCount', 'readyBadge',
  'emptyState', 'toast', 'viewport', 'workspace', 'viewCube', 'bridgeShapeTitle',
  'bridgeSelection', 'selectedBridgeLabel', 'selectedBridgeHint', 'clearBridgeSelection',
  'flipLongEdgeButton',
].map((id) => [id, document.getElementById(id)]));

const state = {
  svgText: sampleSvg,
  fileName: 'bridgeform-logo-solid.svg',
  artworkFlipX: true,
  thickness: 3.5,
  width: 240,
  bridgeWidth: 4,
  archHeight: 15,
  autoConnections: 1,
  bridges: [],
  components: [],
  pending: null,
  selectedBridgeId: null,
  mode: 'add',
  nextId: 1,
  zoom: 1,
};

const renderer = new THREE.WebGLRenderer({ canvas: ui.viewport, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 1200);
camera.up.set(0, -1, 0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.enablePan = true;
controls.enableRotate = true;
controls.enableZoom = true;
controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
controls.enabled = false;

const cubeRenderer = new THREE.WebGLRenderer({ canvas: ui.viewCube, antialias: true, alpha: true });
cubeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
cubeRenderer.setSize(132, 132, false);
cubeRenderer.setClearColor(0x000000, 0);
cubeRenderer.outputColorSpace = THREE.SRGBColorSpace;
cubeRenderer.shadowMap.enabled = false;
const cubeScene = new THREE.Scene();
const cubeCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
const cubeRaycaster = new THREE.Raycaster();
const cubePointer = new THREE.Vector2();

function faceMaterial(label, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, 192, 192);
  context.strokeStyle = '#5bf3c3';
  context.lineWidth = 8;
  context.strokeRect(4, 4, 184, 184);
  context.fillStyle = '#edf8f3';
  context.font = `700 ${label.length > 5 ? 25 : 30}px -apple-system, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, 96, 98);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
}

const cubeLabels = ['RIGHT', 'LEFT', 'FRONT', 'BACK', 'TOP', 'BOTTOM'];
const cubeMaterials = cubeLabels.map((label, index) => faceMaterial(label, index < 2 ? '#224b40' : index < 4 ? '#1d4037' : '#28584a'));
const orientationCube = new THREE.Mesh(new THREE.BoxGeometry(1.55, 1.55, 1.55), cubeMaterials);
orientationCube.castShadow = false;
orientationCube.receiveShadow = false;
cubeScene.add(orientationCube);

const modelRoot = new THREE.Group();
const artworkGroup = new THREE.Group();
const bridgeGroup = new THREE.Group();
const markerGroup = new THREE.Group();
modelRoot.add(artworkGroup, bridgeGroup, markerGroup);
scene.add(modelRoot);

const artMaterial = new THREE.MeshBasicMaterial({ color: 0xeeeae0, side: THREE.DoubleSide, toneMapped: false });
const bridgeMaterial = new THREE.MeshBasicMaterial({ color: 0x50e5b8, toneMapped: false });
const selectedBridgeMaterial = new THREE.MeshBasicMaterial({ color: 0xffc774, toneMapped: false });
const pendingMaterial = new THREE.MeshBasicMaterial({ color: 0xffc774, toneMapped: false });
const loader = new SVGLoader();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const bridgeWidthLimit = Number(ui.bridgeWidth.max);
const bridgeWidthMinimum = Number(ui.bridgeWidth.min);
let toastTimer;

class HalfDonutCurve extends THREE.Curve {
  constructor(start, end, height, baseZ) {
    super();
    this.midpoint = start.clone().add(end).multiplyScalar(0.5);
    this.direction = end.clone().sub(start).setZ(0).normalize();
    this.halfSpan = start.distanceTo(end) / 2;
    this.height = height;
    this.baseZ = baseZ;
  }

  getPoint(amount, target = new THREE.Vector3()) {
    const angle = Math.PI * amount;
    return target.copy(this.midpoint)
      .addScaledVector(this.direction, -Math.cos(angle) * this.halfSpan)
      .setZ(this.baseZ + Math.sin(angle) * this.height);
  }
}

function disposeGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose();
  }
}

function sanitizeSvg(text) {
  if (text.length > 2_000_000) throw new Error('SVG is larger than the 2 MB prototype limit.');
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg') throw new Error('That file is not a valid SVG.');
  // Preserve the safe geometry rule used by many downloaded logos before
  // removing embedded CSS. The supplied Hoonigan artwork declares even-odd
  // filling through a class, which is essential for correct counters/holes.
  doc.querySelectorAll('style').forEach((styleNode) => {
    const rules = styleNode.textContent || '';
    for (const match of rules.matchAll(/\.([\w-]+)\s*\{([^}]*)\}/g)) {
      const fillRule = match[2].match(/fill-rule\s*:\s*(evenodd|nonzero)/i)?.[1]?.toLowerCase();
      if (!fillRule) continue;
      Array.from(doc.getElementsByClassName(match[1])).forEach((element) => element.setAttribute('fill-rule', fillRule));
    }
  });
  doc.querySelectorAll('script, foreignObject, iframe, object, embed, image, audio, video, style').forEach((node) => node.remove());
  doc.querySelectorAll('*').forEach((node) => {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'style' || ((name === 'href' || name.endsWith(':href')) && !value.startsWith('#'))) node.removeAttribute(attribute.name);
    }
  });
  return new XMLSerializer().serializeToString(doc.documentElement);
}

function rawMeshesFromSvg(svgText) {
  const parsed = loader.parse(svgText);
  const meshes = [];
  parsed.paths.forEach((path) => {
    const fill = path.userData?.style?.fill;
    if (fill === 'none') return;
    SVGLoader.createShapes(path).forEach((shape) => {
      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: state.thickness,
        bevelEnabled: false,
        curveSegments: 16,
        steps: 1,
      });
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, artMaterial);
      mesh.userData.sourceShape = shape;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      meshes.push(mesh);
    });
  });
  return meshes;
}

function collectTopSurfacePoints(mesh) {
  const position = mesh.geometry.getAttribute('position');
  const points = [];
  const seen = new Set();
  const point = new THREE.Vector3();
  for (let index = 0; index < position.count; index += 1) {
    point.fromBufferAttribute(position, index);
    if (point.z < state.thickness * 0.96) continue;
    point.applyMatrix4(mesh.matrixWorld);
    const key = `${point.x.toFixed(3)},${point.y.toFixed(3)}`;
    if (!seen.has(key)) {
      seen.add(key);
      points.push(point.clone());
    }
  }
  if (points.length <= 500) return points;
  const stride = Math.ceil(points.length / 500);
  return points.filter((_, index) => index % stride === 0);
}

function outlineForMesh(mesh) {
  const sourceShape = mesh.userData.sourceShape;
  if (!sourceShape) return null;
  const extracted = sourceShape.extractPoints(16);
  const toWorldRing = (ring) => ring.map((point) => {
    const world = new THREE.Vector3(point.x, point.y, state.thickness).applyMatrix4(mesh.matrixWorld);
    return new THREE.Vector2(world.x, world.y);
  });
  return {
    outer: toWorldRing(extracted.shape),
    holes: extracted.holes.map(toWorldRing),
  };
}

function resampleOuterBoundary(outline, maximumPoints = 240) {
  const ring = outline?.outer;
  if (!ring?.length) return [];
  const segments = [];
  let perimeter = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    const length = start.distanceTo(end);
    if (length <= 0.0001) continue;
    segments.push({ start, end, length, offset: perimeter });
    perimeter += length;
  }
  if (!segments.length || perimeter <= 0.0001) return [];
  const pointCount = THREE.MathUtils.clamp(
    Math.ceil(perimeter / Math.max(bridgeWidthMinimum * 0.5, 0.75)),
    48,
    maximumPoints,
  );
  const points = [];
  let segmentIndex = 0;
  for (let index = 0; index < pointCount; index += 1) {
    const distance = perimeter * index / pointCount;
    while (
      segmentIndex < segments.length - 1
      && distance > segments[segmentIndex].offset + segments[segmentIndex].length
    ) segmentIndex += 1;
    const segment = segments[segmentIndex];
    const amount = THREE.MathUtils.clamp((distance - segment.offset) / segment.length, 0, 1);
    points.push(new THREE.Vector3(
      THREE.MathUtils.lerp(segment.start.x, segment.end.x, amount),
      THREE.MathUtils.lerp(segment.start.y, segment.end.y, amount),
      state.thickness,
    ));
  }
  return points;
}

function rebuildArtwork({ rescaleBridges = false, preserveView = false } = {}) {
  disposeGroup(artworkGroup);
  artworkGroup.position.set(0, 0, 0);
  artworkGroup.rotation.set(0, 0, 0);
  artworkGroup.scale.set(1, 1, 1);
  const meshes = rawMeshesFromSvg(state.svgText);
  if (!meshes.length) {
    state.components = [];
    ui.emptyState.hidden = false;
    updateUi();
    return;
  }
  ui.emptyState.hidden = true;

  meshes.forEach((mesh) => artworkGroup.add(mesh));
  const rawBox = new THREE.Box3().setFromObject(artworkGroup);
  const rawWidth = Math.max(rawBox.max.x - rawBox.min.x, 0.001);
  const previousWidth = Number(modelRoot.userData.modelWidth || state.width);
  const scale = state.width / rawWidth;
  artworkGroup.scale.set(state.artworkFlipX ? -scale : scale, scale, 1);
  artworkGroup.updateMatrixWorld(true);
  const scaledBox = new THREE.Box3().setFromObject(artworkGroup);
  const center = scaledBox.getCenter(new THREE.Vector3());
  artworkGroup.position.set(-center.x, -center.y, 0);
  artworkGroup.updateMatrixWorld(true);

  if (rescaleBridges && previousWidth > 0) {
    const ratio = state.width / previousWidth;
    state.bridges.forEach((bridge) => {
      bridge.start.x *= ratio; bridge.start.y *= ratio;
      bridge.end.x *= ratio; bridge.end.y *= ratio;
      if (bridge.startEdge) { bridge.startEdge.x *= ratio; bridge.startEdge.y *= ratio; }
      if (bridge.endEdge) { bridge.endEdge.x *= ratio; bridge.endEdge.y *= ratio; }
      if (Number.isFinite(bridge.maxWidth)) {
        bridge.maxWidth = Math.min(bridgeWidthLimit, bridge.maxWidth * ratio);
      }
      updateSuggestedBridgeAnchors(bridge);
    });
  }
  modelRoot.userData.modelWidth = state.width;

  state.components = meshes.map((mesh, index) => {
    mesh.userData.pieceId = index;
    const box = new THREE.Box3().setFromObject(mesh);
    const outline = outlineForMesh(mesh);
    return {
      index,
      mesh,
      box,
      surfacePoints: collectTopSurfacePoints(mesh),
      outline,
      boundaryPoints: resampleOuterBoundary(outline),
      area: (box.max.x - box.min.x) * (box.max.y - box.min.y),
    };
  });
  rebuildBridges();
  if (!preserveView) frameCamera(false);
  updateUi();
}

function buildBridgeMeshes(bridge) {
  const radius = bridge.width / 2;
  const start = bridge.start.clone();
  const end = bridge.end.clone();
  start.z = state.thickness;
  end.z = state.thickness;
  // The embedded endpoints are lowered to Z=0 below, so include the stencil
  // thickness in the rise to keep the entered arc height relative to its top.
  const curve = new HalfDonutCurve(start, end, bridge.height + state.thickness, state.thickness);
  const distance = start.distanceTo(end);
  const tubularSegments = Math.max(24, Math.min(128, Math.ceil(Math.PI * Math.max(distance / 2, bridge.height) * 1.6)));
  const geometry = new THREE.TubeGeometry(curve, tubularSegments, radius, 12, false);
  // Lower the completed half-donut through the stencil thickness so its true
  // lowest point reaches the build plane and its ends overlap the artwork.
  geometry.computeBoundingBox();
  geometry.translate(0, 0, -geometry.boundingBox.min.z);
  geometry.computeVertexNormals();
  const tube = new THREE.Mesh(geometry, bridge.id === state.selectedBridgeId ? selectedBridgeMaterial : bridgeMaterial);
  tube.castShadow = false;
  tube.receiveShadow = false;
  tube.userData.bridgeId = bridge.id;
  return [tube];
}

function rebuildBridges() {
  disposeGroup(bridgeGroup);
  state.bridges.forEach((bridge) => {
    buildBridgeMeshes(bridge).forEach((mesh) => bridgeGroup.add(mesh));
  });
  updateUi();
}

function showPendingMarker(point) {
  disposeGroup(markerGroup);
  if (!point) return;
  const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(1.2, state.bridgeWidth * 0.72), 20, 12), pendingMaterial);
  marker.position.copy(point);
  marker.position.z += state.bridgeWidth * 0.25;
  marker.castShadow = false;
  markerGroup.add(marker);
}

function addBridge(start, end, startPiece, endPiece, source = 'manual') {
  const startClearance = componentClearance(state.components[startPiece], new THREE.Vector2(start.x, start.y));
  const endClearance = componentClearance(state.components[endPiece], new THREE.Vector2(end.x, end.y));
  const availableWidth = Math.min(startClearance, endClearance) * 2;
  if (availableWidth < bridgeWidthMinimum) {
    showToast(`That location cannot hold a ${bridgeWidthMinimum.toFixed(0)} mm bridge`);
    return;
  }
  const maxWidth = Math.min(availableWidth, bridgeWidthLimit);
  const bridge = {
    id: state.nextId++,
    start: start.clone(),
    end: end.clone(),
    startPiece,
    endPiece,
    source,
    width: Math.min(state.bridgeWidth, maxWidth),
    maxWidth,
    height: state.archHeight,
  };
  state.bridges.push(bridge);
  state.bridgeWidth = bridge.width;
  state.archHeight = bridge.height;
  state.selectedBridgeId = bridge.id;
  state.pending = null;
  showPendingMarker(null);
  rebuildBridges();
  ui.statusText.textContent = `Bridge ${state.bridges.length} selected — adjust its height or width`;
  showToast('Raised bridge added');
}

function boundaryPoint(box, toward) {
  const center = box.getCenter(new THREE.Vector3());
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const delta = toward.clone().sub(center);
  const tx = Math.abs(delta.x) > 0.0001 ? half.x / Math.abs(delta.x) : Infinity;
  const ty = Math.abs(delta.y) > 0.0001 ? half.y / Math.abs(delta.y) : Infinity;
  const t = Math.min(tx, ty) * 0.88;
  return new THREE.Vector3(center.x + delta.x * t, center.y + delta.y * t, state.thickness);
}

function pointInRing(point, ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const a = ring[current];
    const b = ring[previous];
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function pointInsideComponent(component, point) {
  if (!component?.outline?.outer?.length) {
    return point.x >= component.box.min.x && point.x <= component.box.max.x
      && point.y >= component.box.min.y && point.y <= component.box.max.y;
  }
  return pointInRing(point, component.outline.outer)
    && !component.outline.holes.some((ring) => pointInRing(point, ring));
}

function distanceToSegment(point, start, end) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  const amount = lengthSquared > 0
    ? THREE.MathUtils.clamp(((point.x - start.x) * segmentX + (point.y - start.y) * segmentY) / lengthSquared, 0, 1)
    : 0;
  return Math.hypot(point.x - (start.x + segmentX * amount), point.y - (start.y + segmentY * amount));
}

function componentClearance(component, point) {
  if (!component?.outline?.outer?.length) {
    return Math.max(0, Math.min(
      point.x - component.box.min.x,
      component.box.max.x - point.x,
      point.y - component.box.min.y,
      component.box.max.y - point.y,
    ));
  }
  let clearance = Infinity;
  for (const ring of [component.outline.outer, ...component.outline.holes]) {
    for (let index = 0; index < ring.length; index += 1) {
      clearance = Math.min(clearance, distanceToSegment(point, ring[index], ring[(index + 1) % ring.length]));
    }
  }
  return clearance;
}

function chooseInwardDirection(component, edge, preferred) {
  const center = component.box.getCenter(new THREE.Vector3());
  const towardCenter = new THREE.Vector2(center.x - edge.x, center.y - edge.y).normalize();
  const preferred2d = new THREE.Vector2(preferred.x, preferred.y).normalize();
  const candidates = [preferred2d, towardCenter];
  for (let degrees = -90; degrees <= 90; degrees += 15) {
    candidates.push(preferred2d.clone().rotateAround(new THREE.Vector2(), THREE.MathUtils.degToRad(degrees)));
  }
  let bestDirection = preferred2d;
  let bestDepth = 0;
  candidates.forEach((direction) => {
    const probe = new THREE.Vector2(edge.x + direction.x * 0.18, edge.y + direction.y * 0.18);
    if (!pointInsideComponent(component, probe)) return;
    const depth = maxDiameterFromEdge(component, edge, direction);
    if (depth > bestDepth) {
      bestDepth = depth;
      bestDirection = direction;
    }
  });
  return bestDepth >= bridgeWidthMinimum ? bestDirection : null;
}

function maxDiameterFromEdge(component, edge, inward) {
  let usableWidth = 0;
  for (let width = 0.1; width <= bridgeWidthLimit + 0.001; width += 0.1) {
    const requiredDepth = bridgeAnchorInset(width) + width / 2;
    const probe = new THREE.Vector2(edge.x + inward.x * requiredDepth, edge.y + inward.y * requiredDepth);
    if (!pointInsideComponent(component, probe)) break;
    usableWidth = width;
  }
  const stepped = Math.floor((usableWidth + 0.001) / 0.2) * 0.2;
  if (stepped < bridgeWidthMinimum) return 0;
  return THREE.MathUtils.clamp(stepped, bridgeWidthMinimum, bridgeWidthLimit);
}

function prepareSuggestedBridge(from, to, startEdge, endEdge, { horizontal = false } = {}) {
  const outward = endEdge.clone().sub(startEdge).normalize();
  const horizontalDirection = Math.sign(outward.x) || 1;
  const startInward = horizontal
    ? new THREE.Vector2(-horizontalDirection, 0)
    : chooseInwardDirection(from, startEdge, outward.clone().multiplyScalar(-1));
  const endInward = horizontal
    ? new THREE.Vector2(horizontalDirection, 0)
    : chooseInwardDirection(to, endEdge, outward);
  if (!startInward || !endInward) return null;
  const maxWidth = Math.min(
    maxDiameterFromEdge(from, startEdge, startInward),
    maxDiameterFromEdge(to, endEdge, endInward),
  );
  if (maxWidth < bridgeWidthMinimum) return null;
  const width = Math.min(state.bridgeWidth, maxWidth);
  const inset = bridgeAnchorInset(width);
  const start = startEdge.clone().add(new THREE.Vector3(startInward.x, startInward.y, 0).multiplyScalar(inset));
  const end = endEdge.clone().add(new THREE.Vector3(endInward.x, endInward.y, 0).multiplyScalar(inset));
  if (
    componentClearance(from, new THREE.Vector2(start.x, start.y)) < width / 2
    || componentClearance(to, new THREE.Vector2(end.x, end.y)) < width / 2
  ) return null;
  return {
    startEdge: startEdge.clone(),
    endEdge: endEdge.clone(),
    startInward,
    endInward,
    start,
    end,
    maxWidth,
    width,
  };
}

function bridgeAnchorInset(width) {
  return width * 4;
}

function updateSuggestedBridgeAnchors(bridge) {
  if (!bridge.startEdge || !bridge.endEdge || !bridge.startInward || !bridge.endInward) return;
  const inset = bridgeAnchorInset(bridge.width);
  bridge.start.copy(bridge.startEdge).add(new THREE.Vector3(bridge.startInward.x, bridge.startInward.y, 0).multiplyScalar(inset));
  bridge.end.copy(bridge.endEdge).add(new THREE.Vector3(bridge.endInward.x, bridge.endInward.y, 0).multiplyScalar(inset));
}

function effectiveBridgeMaxWidth(bridge) {
  return Math.min(bridge.maxWidth ?? bridgeWidthLimit, bridgeWidthLimit);
}

function nearestSurfacePair(from, to) {
  let start = null;
  let end = null;
  let bestDistanceSquared = Infinity;
  const fromPoints = from.boundaryPoints.length ? from.boundaryPoints : (from.surfacePoints.length ? from.surfacePoints : [from.box.getCenter(new THREE.Vector3())]);
  const toPoints = to.boundaryPoints.length ? to.boundaryPoints : (to.surfacePoints.length ? to.surfacePoints : [to.box.getCenter(new THREE.Vector3())]);
  for (const fromPoint of fromPoints) {
    for (const toPoint of toPoints) {
      const distanceSquared = fromPoint.distanceToSquared(toPoint);
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        start = fromPoint.clone();
        end = toPoint.clone();
      }
    }
  }
  if (!start || !end) {
    const fromCenter = from.box.getCenter(new THREE.Vector3());
    const toCenter = to.box.getCenter(new THREE.Vector3());
    start = boundaryPoint(from.box, toCenter);
    end = boundaryPoint(to.box, fromCenter);
  }

  start.z = state.thickness;
  end.z = state.thickness;
  return { start, end, distance: start.distanceTo(end) };
}

function orientation2d(start, end, point) {
  return (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x);
}

function pointOnSegment2d(point, start, end, epsilon = 0.001) {
  return Math.abs(orientation2d(start, end, point)) <= epsilon
    && point.x >= Math.min(start.x, end.x) - epsilon
    && point.x <= Math.max(start.x, end.x) + epsilon
    && point.y >= Math.min(start.y, end.y) - epsilon
    && point.y <= Math.max(start.y, end.y) + epsilon;
}

function segmentsCross2d(firstStart, firstEnd, secondStart, secondEnd) {
  const a = orientation2d(firstStart, firstEnd, secondStart);
  const b = orientation2d(firstStart, firstEnd, secondEnd);
  const c = orientation2d(secondStart, secondEnd, firstStart);
  const d = orientation2d(secondStart, secondEnd, firstEnd);
  if (((a > 0 && b < 0) || (a < 0 && b > 0)) && ((c > 0 && d < 0) || (c < 0 && d > 0))) return true;
  return (Math.abs(a) <= 0.001 && pointOnSegment2d(secondStart, firstStart, firstEnd))
    || (Math.abs(b) <= 0.001 && pointOnSegment2d(secondEnd, firstStart, firstEnd))
    || (Math.abs(c) <= 0.001 && pointOnSegment2d(firstStart, secondStart, secondEnd))
    || (Math.abs(d) <= 0.001 && pointOnSegment2d(firstEnd, secondStart, secondEnd));
}

function crossingCount(bridge, others) {
  return others.reduce((count, other) => count + (
    segmentsCross2d(bridge.start, bridge.end, other.start, other.end) ? 1 : 0
  ), 0);
}

function horizontalDeviation(bridge) {
  const deltaX = bridge.end.x - bridge.start.x;
  const deltaY = bridge.end.y - bridge.start.y;
  return Math.abs(deltaY) / Math.max(Math.hypot(deltaX, deltaY), 0.001);
}

function chooseEvenlySpacedBridges(valid, requestedCount, existing) {
  if (!valid.length) return [];
  const count = Math.min(requestedCount, valid.length);
  const startYs = valid.map((bridge) => bridge.start.y);
  const endYs = valid.map((bridge) => bridge.end.y);
  const startMinimum = Math.min(...startYs);
  const startMaximum = Math.max(...startYs);
  const endMinimum = Math.min(...endYs);
  const endMaximum = Math.max(...endYs);
  const shortestLength = Math.min(...valid.map((bridge) => bridge.start.distanceTo(bridge.end)));
  const selected = [];
  const compared = [...existing];

  for (let index = 0; index < count; index += 1) {
    const ratio = (index + 1) / (count + 1);
    const targetStartY = THREE.MathUtils.lerp(startMinimum, startMaximum, ratio);
    const targetEndY = THREE.MathUtils.lerp(endMinimum, endMaximum, ratio);
    const candidates = valid
      .filter((bridge) => !selected.includes(bridge))
      .sort((first, second) => {
        const firstCrossings = crossingCount(first, compared);
        const secondCrossings = crossingCount(second, compared);
        if (firstCrossings !== secondCrossings) return firstCrossings - secondCrossings;
        const score = (bridge) => {
          const landingError = Math.abs(bridge.start.y - targetStartY)
            + Math.abs(bridge.end.y - targetEndY);
          const horizontalPenalty = horizontalDeviation(bridge) * state.width * 4;
          const excessLength = Math.max(0, bridge.start.distanceTo(bridge.end) - shortestLength);
          return landingError * 4 + horizontalPenalty + excessLength * 2.5;
        };
        return score(first) - score(second);
      });
    if (!candidates.length) break;
    selected.push(candidates[0]);
    compared.push(candidates[0]);
  }

  return selected;
}

function horizontalBoundaryIntersections(component, y) {
  const ring = component.outline?.outer;
  if (!ring?.length) return [];
  const intersections = [];
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    if ((start.y > y) === (end.y > y)) continue;
    const amount = (y - start.y) / (end.y - start.y);
    intersections.push(THREE.MathUtils.lerp(start.x, end.x, amount));
  }
  return [...new Set(intersections.map((value) => value.toFixed(4)))].map(Number).sort((a, b) => a - b);
}

function horizontalBoundaryPair(from, to, y) {
  const fromXs = horizontalBoundaryIntersections(from, y);
  const toXs = horizontalBoundaryIntersections(to, y);
  if (!fromXs.length || !toXs.length) return null;
  const fromCenterX = from.box.getCenter(new THREE.Vector3()).x;
  const toCenterX = to.box.getCenter(new THREE.Vector3()).x;
  const toTheRight = toCenterX >= fromCenterX;
  const startX = toTheRight ? fromXs[fromXs.length - 1] : fromXs[0];
  const endX = toTheRight ? toXs[0] : toXs[toXs.length - 1];
  return {
    start: new THREE.Vector3(startX, y, state.thickness),
    end: new THREE.Vector3(endX, y, state.thickness),
  };
}

function evenlySpacedHorizontalBridges(from, to, requestedCount, existing) {
  const minimumY = Math.max(from.box.min.y, to.box.min.y);
  const maximumY = Math.min(from.box.max.y, to.box.max.y);
  const verticalSpan = maximumY - minimumY;
  if (verticalSpan <= bridgeWidthMinimum) return [];
  const interval = verticalSpan / (requestedCount + 1);
  const selected = [];
  const offsetRatios = [0, 0.08, -0.08, 0.16, -0.16, 0.24, -0.24, 0.32, -0.32];

  for (let index = 0; index < requestedCount; index += 1) {
    const targetY = minimumY + interval * (index + 1);
    let best = null;
    offsetRatios.forEach((offsetRatio) => {
      const y = targetY + interval * offsetRatio;
      const pair = horizontalBoundaryPair(from, to, y);
      if (!pair) return;
      const prepared = prepareSuggestedBridge(from, to, pair.start, pair.end, { horizontal: true });
      if (!prepared) return;
      const crossings = crossingCount(prepared, [...existing, ...selected]);
      const length = prepared.start.distanceTo(prepared.end);
      const score = crossings * state.width * state.width * 1000
        + Math.abs(offsetRatio) * state.width
        + length;
      if (!best || score < best.score) best = { ...prepared, score };
    });
    if (best) {
      delete best.score;
      selected.push(best);
    }
  }

  return selected;
}

function spacedSurfacePairs(from, to, requestedCount, candidateLimit = requestedCount, avoidSegments = []) {
  const samplePoints = (component) => {
    const points = component.boundaryPoints.length
      ? component.boundaryPoints
      : (component.surfacePoints.length ? component.surfacePoints : [component.box.getCenter(new THREE.Vector3())]);
    // Two-millimetre bridge placement does not benefit from hundreds of
    // sub-millimetre boundary samples, and the Cartesian product is costly.
    const stride = Math.max(1, Math.ceil(points.length / 120));
    return points.filter((_, index) => index % stride === 0);
  };
  const fromPoints = samplePoints(from);
  const toPoints = samplePoints(to);
  const fromSize = from.box.getSize(new THREE.Vector3());
  const toSize = to.box.getSize(new THREE.Vector3());
  const overlapMinY = Math.max(from.box.min.y, to.box.min.y);
  const overlapMaxY = Math.min(from.box.max.y, to.box.max.y);
  const usableVerticalSpan = Math.max(
    overlapMaxY - overlapMinY,
    Math.min(fromSize.y, toSize.y) * 0.5,
  );
  const preferredSeparation = Math.max(
    bridgeWidthMinimum * 1.5,
    usableVerticalSpan / Math.max(requestedCount - 1, 1),
  );
  const selected = [];

  for (let connectionIndex = 0; connectionIndex < candidateLimit; connectionIndex += 1) {
    let separation = preferredSeparation;
    let best = null;
    let fallback = null;
    while (!best && separation >= 0.1) {
      const separationSquared = separation * separation;
      for (const start of fromPoints) {
        for (const end of toPoints) {
          const midpointY = (start.y + end.y) / 2;
          const overlapsExisting = selected.some((pair) => (
            (midpointY - pair.midpointY) ** 2 < separationSquared
          ));
          if (overlapsExisting) continue;
          const distanceSquared = start.distanceToSquared(end);
          const deltaY = end.y - start.y;
          const crossings = crossingCount({ start, end }, avoidSegments)
            + crossingCount({ start, end }, selected);
          const horizontalScore = distanceSquared + deltaY * deltaY * 36;
          const candidate = { start: start.clone(), end: end.clone(), distanceSquared, score: horizontalScore };
          if (crossings === 0 && (!best || horizontalScore < best.score)) {
            best = candidate;
          } else if (crossings > 0) {
            const fallbackScore = horizontalScore + crossings * state.width * state.width * 1000;
            if (!fallback || fallbackScore < fallback.score) fallback = { ...candidate, score: fallbackScore };
          }
        }
      }
      separation *= 0.55;
    }
    best ||= fallback;
    if (!best) break;
    best.start.z = state.thickness;
    best.end.z = state.thickness;
    selected.push({
      start: best.start,
      end: best.end,
      distance: Math.sqrt(best.distanceSquared),
      midpointY: (best.start.y + best.end.y) / 2,
    });
  }

  return selected;
}

function componentPairScore(first, second) {
  const gapX = Math.max(0, first.box.min.x - second.box.max.x, second.box.min.x - first.box.max.x);
  const gapY = Math.max(0, first.box.min.y - second.box.max.y, second.box.min.y - first.box.max.y);
  const firstCenter = first.box.getCenter(new THREE.Vector3());
  const secondCenter = second.box.getCenter(new THREE.Vector3());
  const centerYDifference = Math.abs(firstCenter.y - secondCenter.y);
  // Prefer short connections, with a modest bias toward the horizontal bridges
  // requested for automatic placement.
  return gapX * gapX + gapY * gapY * 4 + centerYDifference * centerYDifference * 0.15;
}

function preparedConnection(from, to, requestedCount, existing) {
  const horizontal = evenlySpacedHorizontalBridges(from, to, requestedCount, existing);
  if (horizontal.length === requestedCount) return horizontal;

  const pairs = spacedSurfacePairs(
    from,
    to,
    requestedCount,
    Math.max(requestedCount + 4, requestedCount * 3),
    existing,
  );
  const valid = [];
  for (const pair of pairs) {
    const bridge = prepareSuggestedBridge(from, to, pair.start, pair.end);
    if (bridge) valid.push(bridge);
  }
  const fallback = chooseEvenlySpacedBridges(valid, requestedCount, existing);
  return fallback.length >= horizontal.length ? fallback : horizontal;
}

async function suggestBridges() {
  const components = state.components;
  if (components.length < 2 || ui.suggestButton.disabled) return;

  const requestedCount = state.autoConnections;
  const candidates = [];
  for (let first = 0; first < components.length - 1; first += 1) {
    for (let second = first + 1; second < components.length; second += 1) {
      candidates.push({
        fromIndex: first,
        toIndex: second,
        score: componentPairScore(components[first], components[second]),
      });
    }
  }
  candidates.sort((first, second) => first.score - second.score);

  const parents = components.map((_, index) => index);
  const findRoot = (index) => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const join = (first, second) => {
    const firstRoot = findRoot(first);
    const secondRoot = findRoot(second);
    if (firstRoot === secondRoot) return false;
    parents[secondRoot] = firstRoot;
    return true;
  };

  const suggested = [];
  const partialCandidates = [];
  let joinedPieces = 0;
  let examined = 0;
  const addConnection = (candidate, prepared) => {
    if (!join(candidate.fromIndex, candidate.toIndex)) return;
    prepared.forEach((bridge) => {
      suggested.push({
        id: state.nextId++,
        ...bridge,
        startPiece: candidate.fromIndex,
        endPiece: candidate.toIndex,
        source: 'suggested',
        height: state.archHeight,
      });
    });
    joinedPieces += 1;
  };

  const originalLabel = ui.suggestButton.textContent;
  ui.suggestButton.disabled = true;
  ui.suggestButton.textContent = 'Finding bridges…';
  try {
    // Kruskal-style selection considers each short candidate once instead of
    // recalculating every connected/unconnected pair after every new bridge.
    for (const candidate of candidates) {
      if (findRoot(candidate.fromIndex) === findRoot(candidate.toIndex)) continue;
      const prepared = preparedConnection(
        components[candidate.fromIndex],
        components[candidate.toIndex],
        requestedCount,
        suggested,
      );
      examined += 1;
      if (prepared.length === requestedCount) addConnection(candidate, prepared);
      else if (prepared.length) partialCandidates.push({ candidate, prepared });
      if (joinedPieces === components.length - 1) break;
      if (examined % 2 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // If a narrow island cannot accept the full requested count, retain the
    // best partial connection rather than leaving it disconnected.
    if (joinedPieces < components.length - 1) {
      partialCandidates.sort((first, second) => (
        second.prepared.length - first.prepared.length
        || first.candidate.score - second.candidate.score
      ));
      for (const { candidate, prepared } of partialCandidates) {
        addConnection(candidate, prepared);
        if (joinedPieces === components.length - 1) break;
      }
    }

    state.bridges = suggested;
    state.selectedBridgeId = null;
    state.pending = null;
    showPendingMarker(null);
    rebuildBridges();
    const expected = Math.max(0, components.length - 1) * requestedCount;
    showToast(suggested.length === expected
      ? `${suggested.length} bridge${suggested.length === 1 ? '' : 's'} suggested`
      : `${suggested.length} valid bridge${suggested.length === 1 ? '' : 's'} fit at ${bridgeWidthMinimum.toFixed(0)} mm or wider`);
  } finally {
    ui.suggestButton.disabled = false;
    ui.suggestButton.textContent = originalLabel;
  }
}

function connectedPieceCount() {
  if (!state.components.length) return 0;
  const primary = [...state.components].sort((a, b) => b.area - a.area)[0].index;
  const adjacency = new Map(state.components.map((component) => [component.index, new Set()]));
  state.bridges.forEach((bridge) => {
    adjacency.get(bridge.startPiece)?.add(bridge.endPiece);
    adjacency.get(bridge.endPiece)?.add(bridge.startPiece);
  });
  const seen = new Set([primary]);
  const queue = [primary];
  while (queue.length) {
    const current = queue.shift();
    adjacency.get(current)?.forEach((next) => {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    });
  }
  return seen.size;
}

function selectedBridge() {
  return state.bridges.find((bridge) => bridge.id === state.selectedBridgeId) || null;
}

function syncBridgeControls() {
  const bridge = selectedBridge();
  const height = bridge?.height ?? state.archHeight;
  const width = bridge?.width ?? state.bridgeWidth;
  const maximum = bridge ? Math.max(bridgeWidthMinimum, effectiveBridgeMaxWidth(bridge)) : bridgeWidthLimit;
  ui.bridgeWidth.max = String(maximum);
  ui.archHeight.value = height;
  ui.bridgeWidth.value = width;
  ui.archHeightValue.textContent = `${height.toFixed(1)} mm`;
  ui.bridgeWidthValue.textContent = `${width.toFixed(1)} mm`;
}

function selectBridge(id) {
  if (!state.bridges.some((bridge) => bridge.id === id)) return;
  state.selectedBridgeId = id;
  state.pending = null;
  showPendingMarker(null);
  syncBridgeControls();
  rebuildBridges();
  const index = state.bridges.findIndex((bridge) => bridge.id === id);
  ui.statusText.textContent = `Bridge ${index + 1} selected — adjust its height or width`;
}

function clearSelectedBridge({ rebuild = true } = {}) {
  if (state.selectedBridgeId === null) return;
  state.selectedBridgeId = null;
  syncBridgeControls();
  if (rebuild) rebuildBridges();
  ui.statusText.textContent = state.mode === 'add'
    ? 'Click one piece, then another, to add a raised bridge'
    : 'Drag to orbit · middle-drag to move · scroll to zoom';
}

function updateUi() {
  const pieceCount = state.components.length;
  const bridgeCount = state.bridges.length;
  const floating = Math.max(0, pieceCount - connectedPieceCount());
  const selected = selectedBridge();
  const selectedIndex = selected ? state.bridges.findIndex((bridge) => bridge.id === selected.id) : -1;
  ui.fileName.textContent = state.fileName;
  ui.fileMeta.textContent = `${pieceCount} piece${pieceCount === 1 ? '' : 's'}`;
  ui.pieceCount.textContent = pieceCount;
  ui.bridgeCount.textContent = bridgeCount;
  ui.bridgeCountBadge.textContent = bridgeCount;
  ui.floatingCount.textContent = floating;
  ui.noConnections.hidden = bridgeCount > 0;
  ui.undoButton.disabled = bridgeCount === 0;
  ui.exportButton.disabled = pieceCount === 0 || floating > 0;
  ui.suggestButton.disabled = pieceCount < 2;
  ui.readyBadge.textContent = floating === 0 && pieceCount > 0 ? 'Ready' : 'Needs bridges';
  ui.readyBadge.classList.toggle('ready', floating === 0 && pieceCount > 0);
  ui.bridgeShapeTitle.textContent = selected ? 'Selected bridge' : 'New bridge defaults';
  ui.bridgeSelection.hidden = !selected;
  if (selected) {
    ui.selectedBridgeLabel.textContent = `Bridge ${String(selectedIndex + 1).padStart(2, '0')} selected`;
    ui.selectedBridgeHint.textContent = `Maximum ${Math.max(bridgeWidthMinimum, effectiveBridgeMaxWidth(selected)).toFixed(1)} mm at these anchors`;
  }
  syncBridgeControls();
  const suggestedTotal = Math.max(1, pieceCount - 1) * state.autoConnections;
  ui.suggestionText.textContent = pieceCount < 2
    ? 'Add artwork with at least two disconnected filled shapes.'
    : `${state.autoConnections} bridge${state.autoConnections === 1 ? '' : 's'} per floating island will create about ${suggestedTotal} connection${suggestedTotal === 1 ? '' : 's'}.`;

  ui.connectionList.replaceChildren();
  state.bridges.forEach((bridge, index) => {
    const row = document.createElement('div');
    row.className = 'connection-item';
    row.classList.toggle('selected', bridge.id === state.selectedBridgeId);
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Edit bridge ${index + 1}`);
    row.innerHTML = `<span>${String(index + 1).padStart(2, '0')}</span><span><strong>Piece ${bridge.startPiece + 1} → ${bridge.endPiece + 1}</strong><small>${bridge.height.toFixed(1)} mm high · ${bridge.width.toFixed(1)} mm wide</small></span><button type="button" aria-label="Delete bridge ${index + 1}" title="Delete bridge">×</button>`;
    row.addEventListener('click', () => selectBridge(bridge.id));
    row.addEventListener('keydown', (event) => {
      if (event.target !== row) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectBridge(bridge.id);
      }
    });
    row.querySelector('button').addEventListener('click', (event) => {
      event.stopPropagation();
      state.bridges = state.bridges.filter((item) => item.id !== bridge.id);
      if (state.selectedBridgeId === bridge.id) state.selectedBridgeId = null;
      rebuildBridges();
    });
    ui.connectionList.appendChild(row);
  });
}

function frameCamera(resetZoom = true) {
  if (resetZoom) state.zoom = 1;
  const box = new THREE.Box3().setFromObject(artworkGroup);
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, state.width);
  camera.position.set(0, span * 0.46, span * 1.38);
  controls.target.set(0, 0, 0);
  camera.lookAt(0, 0, 0);
  camera.zoom = state.zoom;
  camera.updateProjectionMatrix();
  controls.update();
  ui.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function setZoom(next) {
  state.zoom = THREE.MathUtils.clamp(next, 0.55, 2.4);
  camera.zoom = state.zoom;
  camera.updateProjectionMatrix();
  ui.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function resize() {
  const rect = ui.workspace.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(rect.height, 1);
  camera.updateProjectionMatrix();
}

function setRaycasterFromViewportEvent(event) {
  const rect = ui.viewport.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function pointerHitsModel(event) {
  setRaycasterFromViewportEvent(event);
  return raycaster.intersectObjects([
    ...bridgeGroup.children,
    ...state.components.map((component) => component.mesh),
  ], false).length > 0;
}

let viewportGesture = null;
let suppressViewportClick = false;

function handleCanvasClick(event) {
  if (suppressViewportClick) return;
  setRaycasterFromViewportEvent(event);

  const bridgeHit = raycaster.intersectObjects(bridgeGroup.children, false)[0];
  if (bridgeHit?.object.userData.bridgeId != null) {
    selectBridge(bridgeHit.object.userData.bridgeId);
    return;
  }

  if (state.mode !== 'add' || !state.components.length) return;
  const intersections = raycaster.intersectObjects(state.components.map((component) => component.mesh), false);
  if (!intersections.length) {
    if (viewportGesture?.startedOnBackground) return;
    showToast('Click directly on a piece of the artwork');
    return;
  }
  const hit = intersections[0];
  const point = hit.point.clone();
  const pieceId = hit.object.userData.pieceId;
  clearSelectedBridge({ rebuild: true });
  if (!state.pending) {
    state.pending = { point, pieceId };
    showPendingMarker(point);
    ui.statusText.textContent = 'First piece selected — click a different piece';
    return;
  }
  if (state.pending.pieceId === pieceId) {
    showToast('Choose a different piece for the other end');
    return;
  }
  addBridge(state.pending.point, point, state.pending.pieceId, pieceId);
}

function setMode(mode) {
  state.mode = mode;
  state.pending = null;
  showPendingMarker(null);
  ui.addModeButton.classList.toggle('active', mode === 'add');
  ui.inspectModeButton.classList.toggle('active', mode === 'inspect');
  controls.enabled = mode === 'inspect';
  ui.viewport.style.cursor = mode === 'add' ? 'crosshair' : 'default';
  ui.statusText.textContent = mode === 'add'
    ? 'Click one piece, then another, to add a raised bridge'
    : 'Drag to orbit · middle-drag to move · scroll to zoom';
}

function setCameraFace(materialIndex) {
  const distance = Math.max(state.width * 1.25, 110);
  const positions = [
    new THREE.Vector3(distance, 0, 0),
    new THREE.Vector3(-distance, 0, 0),
    new THREE.Vector3(0, distance, 0),
    new THREE.Vector3(0, -distance, 0),
    new THREE.Vector3(0, 0, distance),
    new THREE.Vector3(0, 0, -distance),
  ];
  camera.position.copy(positions[materialIndex] || positions[4]);
  camera.up.set(0, 0, 1);
  if (materialIndex >= 4) camera.up.set(0, -1, 0);
  controls.target.set(0, 0, 0);
  camera.lookAt(controls.target);
  controls.update();
  showToast(`${cubeLabels[materialIndex] || 'Top'} view`);
}

function orbitCameraFromCube(deltaX, deltaY) {
  const offset = camera.position.clone().sub(controls.target);
  offset.applyAxisAngle(new THREE.Vector3(0, 0, 1), -deltaX * 0.012);
  camera.updateMatrixWorld(true);
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const pitched = offset.clone().applyAxisAngle(right, -deltaY * 0.012);
  const vertical = Math.abs(pitched.clone().normalize().dot(new THREE.Vector3(0, 0, 1)));
  if (vertical < 0.985) offset.copy(pitched);
  camera.up.set(0, 0, 1);
  camera.position.copy(controls.target).add(offset);
  camera.lookAt(controls.target);
  controls.update();
}

let cubeGesture = null;
ui.viewCube.addEventListener('pointerdown', (event) => {
  cubeGesture = { x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, dragged: false };
  ui.viewCube.setPointerCapture(event.pointerId);
});
ui.viewCube.addEventListener('pointermove', (event) => {
  if (!cubeGesture) return;
  const deltaX = event.clientX - cubeGesture.lastX;
  const deltaY = event.clientY - cubeGesture.lastY;
  if (Math.hypot(event.clientX - cubeGesture.x, event.clientY - cubeGesture.y) > 3) cubeGesture.dragged = true;
  if (cubeGesture.dragged) orbitCameraFromCube(deltaX, deltaY);
  cubeGesture.lastX = event.clientX;
  cubeGesture.lastY = event.clientY;
});
ui.viewCube.addEventListener('pointerup', (event) => {
  if (!cubeGesture) return;
  if (!cubeGesture.dragged) {
    const rect = ui.viewCube.getBoundingClientRect();
    cubePointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    cubePointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    cubeRaycaster.setFromCamera(cubePointer, cubeCamera);
    const hit = cubeRaycaster.intersectObject(orientationCube, false)[0];
    if (hit?.face) setCameraFace(hit.face.materialIndex);
  }
  cubeGesture = null;
  ui.viewCube.releasePointerCapture(event.pointerId);
});
ui.viewCube.addEventListener('pointercancel', () => { cubeGesture = null; });

function showToast(message) {
  clearTimeout(toastTimer);
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2100);
}

function loadSvgText(text, fileName, clearBridges = true, flipX = false) {
  try {
    state.svgText = sanitizeSvg(text);
    state.fileName = fileName;
    state.artworkFlipX = flipX;
    if (clearBridges) state.bridges = [];
    state.pending = null;
    state.selectedBridgeId = null;
    rebuildArtwork();
    showToast(`${fileName} loaded`);
  } catch (error) {
    showToast(error.message || 'Could not read that SVG');
  }
}

async function handleFile(file) {
  if (!file || (!file.name.toLowerCase().endsWith('.svg') && file.type !== 'image/svg+xml')) {
    showToast('Choose an SVG file');
    return;
  }
  loadSvgText(await file.text(), file.name);
}

function exportAsciiStl() {
  modelRoot.updateMatrixWorld(true);
  const lines = ['solid bridgeform'];
  const meshes = [...artworkGroup.children, ...bridgeGroup.children].filter((item) => item.isMesh);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const edge1 = new THREE.Vector3();
  const edge2 = new THREE.Vector3();
  const normal = new THREE.Vector3();

  for (const mesh of meshes) {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.index;
    const mirrored = mesh.matrixWorld.determinant() < 0;
    const triangleCount = index ? index.count / 3 : position.count / 3;
    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const ia = index ? index.getX(triangle * 3) : triangle * 3;
      const second = index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1;
      const third = index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2;
      const ib = mirrored ? third : second;
      const ic = mirrored ? second : third;
      a.fromBufferAttribute(position, ia).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(position, ib).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(position, ic).applyMatrix4(mesh.matrixWorld);
      normal.copy(edge1.subVectors(b, a).cross(edge2.subVectors(c, a))).normalize();
      lines.push(`facet normal ${normal.x} ${normal.y} ${normal.z}`);
      lines.push(' outer loop');
      lines.push(`  vertex ${a.x} ${a.y} ${a.z}`);
      lines.push(`  vertex ${b.x} ${b.y} ${b.z}`);
      lines.push(`  vertex ${c.x} ${c.y} ${c.z}`);
      lines.push(' endloop', 'endfacet');
    }
  }
  lines.push('endsolid bridgeform');
  const blob = new Blob([lines.join('\n')], { type: 'model/stl' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const baseName = state.fileName.replace(/\.svg$/i, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'bridgeform-stencil';
  link.href = url;
  link.download = `${baseName}-bridged.stl`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('STL exported');
}

ui.svgInput.addEventListener('change', () => handleFile(ui.svgInput.files?.[0]));
ui.sampleButton.addEventListener('click', () => loadSvgText(sampleSvg, 'bridgeform-logo-solid.svg', true, true));
ui.flipLongEdgeButton.addEventListener('click', () => {
  state.artworkFlipX = !state.artworkFlipX;
  const mirrorPoint = (point) => {
    if (!point) return;
    point.x *= -1;
  };
  state.bridges.forEach((bridge) => {
    mirrorPoint(bridge.start);
    mirrorPoint(bridge.end);
    mirrorPoint(bridge.startEdge);
    mirrorPoint(bridge.endEdge);
  });
  mirrorPoint(state.pending?.point);
  rebuildArtwork({ preserveView: true });
  showToast('Artwork mirrored');
});
ui.autoConnections.addEventListener('input', () => {
  state.autoConnections = Number(ui.autoConnections.value);
  ui.autoConnectionsValue.textContent = String(state.autoConnections);
  updateUi();
});
ui.suggestButton.addEventListener('click', suggestBridges);
ui.undoButton.addEventListener('click', () => {
  const removed = state.bridges.pop();
  if (removed?.id === state.selectedBridgeId) state.selectedBridgeId = null;
  rebuildBridges();
});
ui.exportButton.addEventListener('click', exportAsciiStl);
ui.addModeButton.addEventListener('click', () => setMode('add'));
ui.inspectModeButton.addEventListener('click', () => setMode('inspect'));
ui.zoomInButton.addEventListener('click', () => setZoom(state.zoom + 0.15));
ui.zoomOutButton.addEventListener('click', () => setZoom(state.zoom - 0.15));
ui.resetViewButton.addEventListener('click', () => frameCamera(true));
ui.clearBridgeSelection.addEventListener('click', () => clearSelectedBridge());
ui.viewport.addEventListener('pointerdown', (event) => {
  const startedOnBackground = !pointerHitsModel(event);
  const isMiddleDrag = event.button === 1;
  if (isMiddleDrag) event.preventDefault();
  viewportGesture = { x: event.clientX, y: event.clientY, dragged: false, startedOnBackground };
  controls.enabled = state.mode === 'inspect' || startedOnBackground || isMiddleDrag;
}, { capture: true });
ui.viewport.addEventListener('pointermove', (event) => {
  if (!viewportGesture) return;
  if (Math.hypot(event.clientX - viewportGesture.x, event.clientY - viewportGesture.y) > 4) viewportGesture.dragged = true;
}, { capture: true });
ui.viewport.addEventListener('pointerup', () => {
  suppressViewportClick = Boolean(viewportGesture?.dragged);
  setTimeout(() => {
    controls.enabled = state.mode === 'inspect';
    viewportGesture = null;
    suppressViewportClick = false;
  }, 0);
}, { capture: true });
ui.viewport.addEventListener('pointercancel', () => {
  controls.enabled = state.mode === 'inspect';
  viewportGesture = null;
  suppressViewportClick = false;
}, { capture: true });
ui.viewport.addEventListener('click', handleCanvasClick);
ui.viewport.addEventListener('wheel', (event) => {
  if (event.deltaY === 0) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  setZoom(state.zoom + (event.deltaY < 0 ? 0.12 : -0.12));
}, { passive: false, capture: true });

ui.archHeight.addEventListener('input', () => {
  const value = Number(ui.archHeight.value);
  const bridge = selectedBridge();
  if (bridge) {
    bridge.height = value;
    updateSuggestedBridgeAnchors(bridge);
  }
  state.archHeight = value;
  ui.archHeightValue.textContent = `${value.toFixed(1)} mm`;
  rebuildBridges();
});

ui.bridgeWidth.addEventListener('input', () => {
  const requested = Number(ui.bridgeWidth.value);
  const bridge = selectedBridge();
  const value = bridge
    ? Math.min(requested, Math.max(bridgeWidthMinimum, effectiveBridgeMaxWidth(bridge)))
    : requested;
  if (bridge) {
    bridge.width = value;
    updateSuggestedBridgeAnchors(bridge);
  }
  state.bridgeWidth = value;
  ui.bridgeWidth.value = value;
  ui.bridgeWidthValue.textContent = `${value.toFixed(1)} mm`;
  rebuildBridges();
});

const rangeBindings = [
  ['modelThickness', 'modelThicknessValue', 'thickness', (value) => `${value.toFixed(1)} mm`, () => rebuildArtwork({ preserveView: true })],
  ['modelWidth', 'modelWidthValue', 'width', (value) => `${Math.round(value)} mm`, () => rebuildArtwork({ rescaleBridges: true, preserveView: true })],
];
rangeBindings.forEach(([inputId, outputId, stateKey, format, onChange]) => {
  ui[inputId].addEventListener('input', () => {
    const value = Number(ui[inputId].value);
    state[stateKey] = value;
    ui[outputId].textContent = format(value);
    onChange();
  });
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') clearSelectedBridge();
});

const uploadCard = document.querySelector('.upload-card');
for (const target of [uploadCard, ui.workspace]) {
  target.addEventListener('dragover', (event) => { event.preventDefault(); uploadCard.classList.add('dragover'); });
  target.addEventListener('dragleave', () => uploadCard.classList.remove('dragover'));
  target.addEventListener('drop', (event) => {
    event.preventDefault();
    uploadCard.classList.remove('dragover');
    handleFile(event.dataTransfer?.files?.[0]);
  });
}

new ResizeObserver(resize).observe(ui.workspace);

function renderOrientationCube() {
  const direction = camera.position.clone().sub(controls.target).normalize();
  cubeCamera.position.copy(direction.multiplyScalar(4.6));
  cubeCamera.up.copy(camera.up);
  cubeCamera.lookAt(0, 0, 0);
  cubeRenderer.render(cubeScene, cubeCamera);
}

function animate() {
  controls.update();
  renderer.render(scene, camera);
  renderOrientationCube();
  requestAnimationFrame(animate);
}

resize();
rebuildArtwork();
animate();
