import * as THREE from "three"

// One WebGLRenderer for every card: browsers cap a page at ~16 contexts, and a
// 3D portfolio can list more models than that. Each card gets a 2D canvas and
// the renderer's output is copied into it.
const RENDER_WIDTH = 512
const RENDER_HEIGHT = 384
const FRAME_MS = 1000 / 30
const MAX_ANIMATED = 8
const LOAD_TIMEOUT_MS = 45000
const MAX_CONCURRENT_LOADS = 3

const Z_UP = new Set(["stl", "ply", "3mf", "pcd", "3ds"])

export interface ModelViewHandle {
  dispose(): void
}

interface Instance {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  pivot: THREE.Object3D
  mixer: THREE.AnimationMixer | null
  visible: boolean
  needsRender: boolean
  disposed: boolean
}

const instances = new Set<Instance>()
let sharedRenderer: THREE.WebGLRenderer | null = null
let sharedEnvironment: THREE.Texture | null = null
let RoomEnvironmentCtor: new () => THREE.Scene
let frameHandle = 0
let lastFrame = 0

function renderer(): THREE.WebGLRenderer {
  if (sharedRenderer) return sharedRenderer

  const created = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  })
  created.setSize(RENDER_WIDTH, RENDER_HEIGHT, false)
  created.setClearAlpha(0)
  created.outputColorSpace = THREE.SRGBColorSpace
  created.toneMapping = THREE.ACESFilmicToneMapping
  created.toneMappingExposure = 1

  // Dropping the renderer is enough to recover — three still holds the geometry
  // and re-uploads it to the next one.
  created.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault()
    sharedRenderer = null
    sharedEnvironment = null
    for (const instance of instances) instance.needsRender = true
  })

  sharedRenderer = created
  return created
}

function environment(active: THREE.WebGLRenderer): THREE.Texture | null {
  if (sharedEnvironment) return sharedEnvironment
  try {
    const pmrem = new THREE.PMREMGenerator(active)
    const room = new RoomEnvironmentCtor()
    sharedEnvironment = pmrem.fromScene(room, 0.04).texture
    room.traverse(disposeNode)
    pmrem.dispose()
  } catch {
    sharedEnvironment = null
  }
  return sharedEnvironment
}

function frame(time: number) {
  frameHandle = requestAnimationFrame(frame)
  if (time - lastFrame < FRAME_MS) return

  const delta = Math.min((time - lastFrame) / 1000, 0.1)
  lastFrame = time

  let animated = 0
  const active = renderer()

  for (const instance of instances) {
    if (instance.disposed) continue

    const moving = instance.visible && animated < MAX_ANIMATED
    if (moving) animated += 1
    else if (!instance.needsRender) continue

    if (moving) {
      instance.pivot.rotation.y += delta * 0.6
      instance.mixer?.update(delta)
    }

    active.render(instance.scene, instance.camera)
    const { ctx, canvas } = instance
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(active.domElement, 0, 0, canvas.width, canvas.height)
    instance.needsRender = false
  }
}

function startLoop() {
  if (frameHandle) return
  lastFrame = performance.now()
  frameHandle = requestAnimationFrame(frame)
}

function stopLoop() {
  if (!frameHandle || instances.size) return
  cancelAnimationFrame(frameHandle)
  frameHandle = 0
  sharedRenderer?.dispose()
  sharedRenderer = null
  sharedEnvironment = null
}

function materialsOf(node: THREE.Object3D): THREE.Material[] {
  const material = (node as Partial<THREE.Mesh>).material
  if (!material) return []
  return Array.isArray(material) ? material : [material]
}

function disposeNode(node: THREE.Object3D) {
  const mesh = node as Partial<THREE.Mesh>
  mesh.geometry?.dispose()
  for (const entry of materialsOf(node)) {
    for (const value of Object.values(entry)) {
      if (value instanceof THREE.Texture) value.dispose()
    }
    entry.dispose()
  }
}

async function loadObject(
  url: string,
  ext: string,
): Promise<{ object: THREE.Object3D; animations: THREE.AnimationClip[] }> {
  switch (ext) {
    case "obj": {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js")
      return { object: await new OBJLoader().loadAsync(url), animations: [] }
    }
    case "fbx": {
      const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js")
      const group = await new FBXLoader().loadAsync(url)
      return { object: group, animations: group.animations ?? [] }
    }
    case "dae": {
      const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js")
      const collada = await new ColladaLoader().loadAsync(url)
      if (!collada?.scene) throw new Error("Collada file has no scene")
      return { object: collada.scene, animations: collada.scene.animations ?? [] }
    }
    case "stl": {
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js")
      return { object: solid(await new STLLoader().loadAsync(url)), animations: [] }
    }
    case "ply": {
      const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js")
      return { object: solid(await new PLYLoader().loadAsync(url)), animations: [] }
    }
    case "3mf": {
      const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js")
      return { object: await new ThreeMFLoader().loadAsync(url), animations: [] }
    }
    case "usdz": {
      const { USDZLoader } = await import("three/examples/jsm/loaders/USDZLoader.js")
      return { object: await new USDZLoader().loadAsync(url), animations: [] }
    }
    case "wrl":
    case "vrml": {
      const { VRMLLoader } = await import("three/examples/jsm/loaders/VRMLLoader.js")
      return { object: await new VRMLLoader().loadAsync(url), animations: [] }
    }
    case "3ds": {
      const { TDSLoader } = await import("three/examples/jsm/loaders/TDSLoader.js")
      return { object: await new TDSLoader().loadAsync(url), animations: [] }
    }
    case "pcd": {
      const { PCDLoader } = await import("three/examples/jsm/loaders/PCDLoader.js")
      return { object: await new PCDLoader().loadAsync(url), animations: [] }
    }
    case "vox": {
      const { VOXLoader, VOXMesh } = await import("three/examples/jsm/loaders/VOXLoader.js")
      // three returns a bare array here; its published types say
      // `{ chunks, scene }`. Accept either.
      const result = (await new VOXLoader().loadAsync(url)) as unknown as
        | ConstructorParameters<typeof VOXMesh>[0][]
        | { chunks: ConstructorParameters<typeof VOXMesh>[0][] }
      const chunks = Array.isArray(result) ? result : (result?.chunks ?? [])

      const group = new THREE.Group()
      for (const chunk of chunks) group.add(new VOXMesh(chunk))
      return { object: group, animations: [] }
    }
    case "splat": {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return { object: parseSplat(await response.arrayBuffer()), animations: [] }
    }
    default:
      throw new Error(`No loader for .${ext}`)
  }
}

// STL and PLY return bare geometry, and a PLY with no faces is a scan.
function solid(geometry: THREE.BufferGeometry): THREE.Object3D {
  const hasColor = Boolean(geometry.getAttribute("color"))
  const faceless = !geometry.getIndex() && !geometry.getAttribute("normal")

  if (faceless && geometry.getAttribute("position")) {
    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({ size: 1, vertexColors: hasColor, color: hasColor ? 0xffffff : 0x9aa5a1 }),
    )
  }

  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals()
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: hasColor ? 0xffffff : 0xb4beba,
      vertexColors: hasColor,
      metalness: 0.1,
      roughness: 0.7,
      side: THREE.DoubleSide,
    }),
  )
}

// 32-byte records: 3 float32 position, 3 float32 scale, 4 byte colour, 4 byte
// rotation. Drawing the centres as points isn't a gaussian rasteriser, but it
// reads as the object.
function parseSplat(buffer: ArrayBuffer): THREE.Object3D {
  const STRIDE = 32
  const count = Math.floor(buffer.byteLength / STRIDE)
  if (!count) throw new Error("Empty splat file")

  const floats = new Float32Array(buffer)
  const bytes = new Uint8Array(buffer)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)

  for (let i = 0; i < count; i += 1) {
    const f = i * 8
    positions[i * 3] = floats[f]
    positions[i * 3 + 1] = floats[f + 1]
    positions[i * 3 + 2] = floats[f + 2]

    const b = i * STRIDE + 24
    colors[i * 3] = bytes[b] / 255
    colors[i * 3 + 1] = bytes[b + 1] / 255
    colors[i * 3 + 2] = bytes[b + 2] / 255
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3))
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: 1, vertexColors: true }),
  )
}

// Captures keep far-off stragglers, and a box sized to those leaves the subject
// a dot in the middle of the card. Null for anything that isn't purely points.
function pointBounds(root: THREE.Object3D): THREE.Box3 | null {
  const clouds: THREE.Points[] = []
  let other = false
  root.traverse((node) => {
    if (node instanceof THREE.Points) clouds.push(node)
    else if (node instanceof THREE.Mesh) other = true
  })
  if (other || !clouds.length) return null

  const samples: number[][] = [[], [], []]
  for (const cloud of clouds) {
    const position = cloud.geometry.getAttribute("position")
    if (!position) continue
    const step = Math.max(1, Math.floor(position.count / 50000))
    for (let i = 0; i < position.count; i += step) {
      samples[0].push(position.getX(i))
      samples[1].push(position.getY(i))
      samples[2].push(position.getZ(i))
    }
  }
  if (!samples[0].length) return null

  const edges = samples.map((axis) => {
    axis.sort((a, b) => a - b)
    const cut = Math.floor(axis.length * 0.05)
    return [axis[cut], axis[axis.length - 1 - cut]] as const
  })
  return new THREE.Box3(
    new THREE.Vector3(edges[0][0], edges[1][0], edges[2][0]),
    new THREE.Vector3(edges[0][1], edges[1][1], edges[2][1]),
  )
}

let loadsInFlight = 0
const loadQueue: Array<() => void> = []

async function withLoadSlot<T>(run: () => Promise<T>): Promise<T> {
  if (loadsInFlight >= MAX_CONCURRENT_LOADS) {
    await new Promise<void>((resolve) => loadQueue.push(resolve))
  }
  loadsInFlight += 1
  try {
    return await run()
  } finally {
    loadsInFlight -= 1
    loadQueue.shift()?.()
  }
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out loading model")), LOAD_TIMEOUT_MS)
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

/** Draws the first of `urls` that loads, and rejects only if every one fails. */
export async function mountModel3D(
  canvas: HTMLCanvasElement,
  { urls, ext }: { urls: string[]; ext: string },
): Promise<ModelViewHandle> {
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("No 2D context")

  if (!RoomEnvironmentCtor) {
    const room = await import("three/examples/jsm/environments/RoomEnvironment.js")
    RoomEnvironmentCtor = room.RoomEnvironment as unknown as new () => THREE.Scene
  }

  let loaded: { object: THREE.Object3D; animations: THREE.AnimationClip[] } | null = null
  let lastError: unknown = new Error("No model URL")

  for (const url of urls) {
    try {
      loaded = await withLoadSlot(() => withTimeout(loadObject(url, ext)))
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!loaded) throw lastError

  canvas.width = RENDER_WIDTH
  canvas.height = RENDER_HEIGHT

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, RENDER_WIDTH / RENDER_HEIGHT, 0.01, 100)
  camera.position.set(1.6, 1.05, 2.2).setLength(3.1)
  camera.lookAt(0, 0, 0)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f94, 1.1))
  const key = new THREE.DirectionalLight(0xffffff, 2.2)
  key.position.set(3, 5, 4)
  scene.add(key)
  scene.environment = environment(renderer())

  const { object, animations } = loaded

  // Scaled to a unit sphere at the origin, so one camera position frames a 2m
  // character and a 400mm printer part alike.
  const box = pointBounds(object) ?? new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  if (!Number.isFinite(size.x) || size.length() === 0) {
    object.traverse(disposeNode)
    throw new Error("Model has no geometry")
  }
  object.position.sub(box.getCenter(new THREE.Vector3()))
  const radius = Math.max(size.length() / 2, 1e-6)

  const pivot = new THREE.Group()
  pivot.add(object)
  pivot.scale.setScalar(1 / radius)
  if (Z_UP.has(ext)) object.rotateX(-Math.PI / 2)
  if (ext === "splat") object.rotateX(Math.PI)
  scene.add(pivot)

  object.traverse((node) => {
    // Point size is set for metres and draws as invisible specks once scaled.
    if (node instanceof THREE.Points && node.material instanceof THREE.PointsMaterial) {
      node.material.size = radius / 60
      node.material.sizeAttenuation = true
      return
    }
    // A texture that didn't load leaves 3DS and OBJ on black, painting a
    // silhouette.
    for (const material of materialsOf(node)) {
      const shaded = material as Partial<THREE.MeshStandardMaterial>
      if (shaded.color && !shaded.map && shaded.color.getHex() === 0x000000) {
        shaded.color.setHex(0xb4beba)
      }
    }
  })

  let mixer: THREE.AnimationMixer | null = null
  if (animations.length) {
    mixer = new THREE.AnimationMixer(object)
    mixer.clipAction(animations[0]).play()
  }

  const instance: Instance = {
    canvas,
    ctx,
    scene,
    camera,
    pivot,
    mixer,
    visible: true,
    needsRender: true,
    disposed: false,
  }
  instances.add(instance)

  const observer = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1]
    instance.visible = entry.isIntersecting
    if (entry.isIntersecting) instance.needsRender = true
  })
  observer.observe(canvas)

  startLoop()

  return {
    dispose() {
      if (instance.disposed) return
      instance.disposed = true
      observer.disconnect()
      instances.delete(instance)
      mixer?.stopAllAction()
      scene.traverse(disposeNode)
      stopLoop()
    },
  }
}
