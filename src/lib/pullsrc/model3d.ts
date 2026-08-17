// `gltf` goes to <model-viewer>, `three` to the loaders in model3d-viewer.ts,
// `null` to an icon — .blend needs Blender, STEP and IGES need a CAD kernel.
export type ModelRenderer = "gltf" | "three" | null

const RENDERER: Record<string, ModelRenderer> = {
  glb: "gltf",
  gltf: "gltf",
  // A .vrm is a glTF binary; its extensions only affect rigging.
  vrm: "gltf",

  obj: "three",
  fbx: "three",
  dae: "three",
  stl: "three",
  ply: "three",
  "3mf": "three",
  usdz: "three",
  wrl: "three",
  vrml: "three",
  "3ds": "three",
  vox: "three",
  pcd: "three",
  splat: "three",

  blend: null,
  step: null,
  stp: null,
  iges: null,
  igs: null,
  // X3D is VRML's XML successor; three only ships a VRML parser.
  x3d: null,
}

const SINGLE_FILE = new Set(["stl", "ply", "3mf", "fbx", "vox", "pcd", "splat", "usdz", "3ds"])

export function modelExtension(url: string, fileType?: string): string {
  const path = url.split(/[?#]/)[0]
  const match = /\.([a-z0-9]{2,5})$/i.exec(path)
  if (match) return match[1].toLowerCase()
  return (fileType ?? "").toLowerCase().replace(/^\./, "")
}

export function modelRenderer(url: string, fileType?: string): ModelRenderer {
  return RENDERER[modelExtension(url, fileType)] ?? null
}

/**
 * Whether a proxied copy is worth retrying after a direct load fails. Multi-file
 * formats resolve their textures and buffers relative to the URL they came from,
 * which a proxy URL breaks.
 */
export function canRetryProxied(url: string, fileType?: string): boolean {
  const ext = modelExtension(url, fileType)
  return SINGLE_FILE.has(ext) || ext === "glb" || ext === "vrm"
}
