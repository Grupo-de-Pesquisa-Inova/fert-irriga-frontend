import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  type JSX,
} from "solid-js";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { demonstrationFrame, DEMO_DURATION } from "../lib/greenhouse-demo";
import type { ScenarioDefinition } from "../services/api";
import styles from "./Scenarios.module.css";
import {
  Box,
  PanelsTopLeft,
  SlidersHorizontal,
  Pause,
  Play,
  RotateCcw,
} from "lucide-solid";

export default function Greenhouse3D(props: {
  children?: JSX.Element;
  selectedValve: string;
  valvePanel?: JSX.Element;
  scenario?: ScenarioDefinition;
  outputs: string[];
  demonstration: boolean;
  flowing: boolean;
  online: boolean;
  onValveSelect: (target: string) => void;
}) {
  let host!: HTMLDivElement;
  let viewer!: HTMLElement;
  let popover: HTMLDivElement | undefined;
  let model: THREE.Group | undefined;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal("");
  const [inspectionReady, setInspectionReady] = createSignal(false);
  const [movingCamera, setMovingCamera] = createSignal(false);
  const [anchor, setAnchor] = createSignal({ x: 0, y: 0, left: 0, top: 0 });
  const viewOffset = new THREE.Vector2(0, 0.12);
  let valvePoint: THREE.Vector3 | undefined;
  let savedView: { position: THREE.Vector3; target: THREE.Vector3; offset: THREE.Vector2 } | undefined;
  let flight: {
    from: THREE.Vector3; to: THREE.Vector3;
    fromTarget: THREE.Vector3; toTarget: THREE.Vector3;
    fromOffset: THREE.Vector2; toOffset: THREE.Vector2;
    elapsed: number; opening: boolean;
  } | undefined;
  const [cameraView, setCameraView] = createSignal<
    "overview" | "top" | "hydraulics"
  >("overview");
  const meshes: THREE.Mesh[] = [];
  const valves: {
    mesh: THREE.Mesh;
    closed: THREE.Quaternion;
    opened: THREE.Quaternion;
  }[] = [];
  let flowParticles: THREE.InstancedMesh | undefined;
  const routes: {
    group: string;
    start: THREE.Vector3;
    end: THREE.Vector3;
    length: number;
  }[] = [];
  let activeGroups: string[] = [];
  let activeOutputs: string[] = [];
  let demoElapsed = 0;
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const [paused, setPaused] = createSignal(reducedMotion);
  const [demoTime, setDemoTime] = createSignal(0);
  const frame = () => demonstrationFrame(demoTime());

  function updateViewOffset() {
    camera.setViewOffset(host.clientWidth, host.clientHeight,
      host.clientWidth * viewOffset.x, host.clientHeight * viewOffset.y,
      host.clientWidth, host.clientHeight);
  }
  createEffect(() => {
    const selected = props.selectedValve;
    if (!ready()) return;
    setInspectionReady(false);
    if (selected) {
      const mesh = meshes.find((m) => m.userData.output === selected && m.name.endsWith("_corpo"))
        ?? meshes.find((m) => m.userData.output === selected);
      if (!mesh) return;
      controls.enableDamping = false;
      controls.update();
      savedView ??= { position: camera.position.clone(), target: controls.target.clone(), offset: viewOffset.clone() };
      valvePoint = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      const direction = camera.position.clone().sub(controls.target).normalize();
      flight = {
        from: camera.position.clone(), to: valvePoint.clone().addScaledVector(direction, 2.1),
        fromTarget: controls.target.clone(), toTarget: valvePoint.clone(),
        fromOffset: viewOffset.clone(), toOffset: new THREE.Vector2(host.clientWidth < 580 ? 0 : 0.12, host.clientWidth < 580 ? 0.24 : 0),
        elapsed: 0, opening: true,
      };
      controls.enabled = false;
      setMovingCamera(true);
    } else if (savedView) {
      flight = {
        from: camera.position.clone(), to: savedView.position,
        fromTarget: controls.target.clone(), toTarget: savedView.target,
        fromOffset: viewOffset.clone(), toOffset: savedView.offset,
        elapsed: 0, opening: false,
      };
      savedView = undefined;
      valvePoint = undefined;
      setMovingCamera(true);
    }
  });

  createEffect(() => {
    props.demonstration;
    props.scenario?.id;
    demoElapsed = reducedMotion ? 5 : 0;
    setDemoTime(demoElapsed);
    setPaused(reducedMotion);
  });

  function view(kind: "overview" | "top" | "hydraulics") {
    if (!controls || flight || props.selectedValve) return;
    setCameraView(kind);
    controls.target.set(
      0,
      kind === "hydraulics" ? 0.7 : 0.3,
      kind === "hydraulics" ? -2 : 0,
    );
    camera.position.set(
      ...((kind === "top"
        ? [0, 11, 0.01]
        : kind === "hydraulics"
          ? [3, 3.3, 1.5]
          : [4.4, 4.4, 6]) as [number, number, number]),
    );
    controls.update();
  }
  function dispose(root: THREE.Object3D) {
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const value of Object.values(m))
          if (value instanceof THREE.Texture) value.dispose();
        m.dispose();
      }
    });
  }
  onMount(() => {
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(
        "Não foi possível iniciar o 3D. Os cenários e controles continuam disponíveis abaixo.",
      );
      return;
    }
    let destroyed = false;
    const scene = new THREE.Scene();
    const liquidMaps: THREE.DataTexture[] = [];
    camera = new THREE.PerspectiveCamera(40, 1, 0.05, 100);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute(
      "aria-label",
      "Estufa 3D. Arraste para girar; use dois dedos ou a roda para aproximar. Vistas alternativas nos botões abaixo.",
    );
    host.appendChild(renderer.domElement);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reducedMotion;
    controls.minDistance = 1.5;
    controls.maxDistance = 22;
    controls.maxPolarAngle = Math.PI / 2;
    view("overview");
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    let environment = pmrem.fromScene(room, 0.04);
    room.dispose();
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.65;
    new HDRLoader().load(
      "/models/greenhouse-light.hdr",
      (hdr) => {
        if (destroyed) {
          hdr.dispose();
          return;
        }
        const next = pmrem.fromEquirectangular(hdr);
        environment.dispose();
        environment = next;
        scene.environment = environment.texture;
        hdr.dispose();
      },
      undefined,
      () => {
        /* Keep the local studio environment if HDR loading fails. */
      },
    );
    scene.add(new THREE.HemisphereLight(0xdce8ff, 0x8b7864, 0.5));
    const light = new THREE.DirectionalLight(0xfff2df, 3);
    light.position.set(-3, 8, 4);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, {
      left: -6,
      right: 6,
      top: 6,
      bottom: -6,
      near: 0.5,
      far: 22,
    });
    light.shadow.bias = -0.00015;
    light.shadow.normalBias = 0.006;
    light.shadow.radius = 3;
    scene.add(light);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(22, 22),
      new THREE.ShadowMaterial({ opacity: 0.3 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.007;
    ground.receiveShadow = true;
    scene.add(ground);
    const resize = new ResizeObserver(() => {
      const width = host.clientWidth,
        height = host.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.fov = Math.min(74, 40 * Math.max(1, 1.35 / camera.aspect));
      // Shift the scene upward without changing its angle or scale.
      updateViewOffset();
    });
    resize.observe(host);
    new GLTFLoader().load(
      "/models/estufa.glb?v=pbr-2",
      (gltf) => {
        if (destroyed) {
          dispose(gltf.scene);
          return;
        }
        model = gltf.scene;
        model.traverse((o) => {
          if (!(o instanceof THREE.Mesh)) return;
          o.material = Array.isArray(o.material)
            ? o.material.map((m) => m.clone())
            : o.material.clone();
          for (const m of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            if (m instanceof THREE.MeshStandardMaterial) {
              if (
                o.name.startsWith("Liquido_") &&
                m instanceof THREE.MeshPhysicalMaterial
              ) {
                const size = 64,
                  pixels = new Uint8Array(size * size * 4);
                for (let y = 0; y < size; y++)
                  for (let x = 0; x < size; x++) {
                    const i = (y * size + x) * 4;
                    pixels[i] =
                      128 +
                      Math.round(
                        16 *
                          Math.cos(
                            (x / size) * Math.PI * 8 +
                              Math.sin((y / size) * Math.PI * 4),
                          ),
                      );
                    pixels[i + 1] =
                      128 +
                      Math.round(
                        16 *
                          Math.sin(
                            (y / size) * Math.PI * 6 +
                              Math.sin((x / size) * Math.PI * 4),
                          ),
                      );
                    pixels[i + 2] = 253;
                    pixels[i + 3] = 255;
                  }
                const normal = new THREE.DataTexture(pixels, size, size);
                normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
                normal.magFilter = normal.minFilter = THREE.LinearFilter;
                normal.repeat.set(3, 3);
                normal.needsUpdate = true;
                m.normalMap = normal;
                m.normalScale.set(0.25, 0.25);
                m.roughness = 0.08;
                m.transmission = 0.9;
                m.thickness = 0.3;
                m.ior = 1.333;
                m.color.lerp(new THREE.Color(0xffffff), 0.7);
                liquidMaps.push(normal);
                const positions = o.geometry.getAttribute("position");
                const uv = new Float32Array(positions.count * 2);
                for (let i = 0; i < positions.count; i++) {
                  uv[i * 2] = positions.getX(i);
                  uv[i * 2 + 1] = positions.getZ(i);
                }
                o.geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
              }
              if (m.name === "Filme_estufa") {
                m.transparent = true;
                m.opacity = 0.18;
                m.depthWrite = false;
                m.roughness = 0.3;
              }
              m.userData.baseColor = m.color.clone();
              if (m.map)
                m.map.anisotropy = Math.min(
                  8,
                  renderer.capabilities.getMaxAnisotropy(),
                );
              if (m.normalMap)
                m.normalMap.anisotropy = Math.min(
                  8,
                  renderer.capabilities.getMaxAnisotropy(),
                );
            }
          }
          o.castShadow = !/rotulo|Rotulo|Logo|LED|Liquido|Jato|Filme/.test(
            o.name,
          );
          o.receiveShadow = true;
          o.userData.closedQuaternion = o.quaternion.clone();
          if (o.name.endsWith("_alavanca")) {
            const opened = o.quaternion
              .clone()
              .multiply(
                new THREE.Quaternion().setFromAxisAngle(
                  new THREE.Vector3(0, 1, 0),
                  -Math.PI / 2,
                ),
              );
            valves.push({ mesh: o, closed: o.quaternion.clone(), opened });
          }
          if (o.userData.flow_start && o.userData.flow_end) {
            const start = new THREE.Vector3().fromArray(o.userData.flow_start);
            const end = new THREE.Vector3().fromArray(o.userData.flow_end);
            routes.push({
              group: o.userData.flow_group,
              start,
              end,
              length: start.distanceTo(end),
            });
          }
          meshes.push(o);
        });
        const capacity = routes.reduce(
          (count, route) => count + Math.max(1, Math.ceil(route.length / 0.22)),
          0,
        );
        flowParticles = new THREE.InstancedMesh(
          new THREE.SphereGeometry(0.025, 8, 6),
          new THREE.MeshPhysicalMaterial({
            color: 0x82d9ff,
            metalness: 0.05,
            roughness: 0.1,
            transparent: true,
            opacity: 0.85,
            emissive: 0x237aa0,
            emissiveIntensity: 0.4,
          }),
          Math.max(1, capacity),
        );
        flowParticles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        flowParticles.frustumCulled = false;
        flowParticles.count = 0;
        scene.add(flowParticles);
        scene.add(model);
        setReady(true);
      },
      undefined,
      () => {
        if (!destroyed)
          setError(
            "Falha ao carregar o modelo 3D. Reabra a aba para tentar novamente.",
          );
      },
    );
    const raycaster = new THREE.Raycaster();
    let down = [0, 0];
    const pointerDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
    };
    const pointerUp = (e: PointerEvent) => {
      if (props.selectedValve || flight) return;
      if (e.button !== 0 || !e.isPrimary) return;
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster.intersectObjects(
        meshes.filter((m) => /^V/.test(m.userData.output ?? "") && m.visible),
        false,
      )[0];
      if (hit) props.onValveSelect(String(hit.object.userData.output));
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    const dummy = new THREE.Object3D();
    const position = new THREE.Vector3();
    let previousTime = 0;
    let lastUiTime = -1;
    let motionTime = 0;
    renderer.setAnimationLoop((time) => {
      const delta = previousTime
        ? Math.min((time - previousTime) / 1000, 0.05)
        : 0;
      previousTime = time;
      if (document.hidden) return;
      if (flight) {
        flight.elapsed += delta;
        const t = reducedMotion ? 1 : Math.min(1, flight.elapsed / 0.7);
        const eased = t * t * (3 - 2 * t);
        camera.position.lerpVectors(flight.from, flight.to, eased);
        controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased);
        viewOffset.lerpVectors(flight.fromOffset, flight.toOffset, eased);
        updateViewOffset();
        if (t === 1) {
          setInspectionReady(flight.opening);
          controls.enabled = !flight.opening;
          controls.enableDamping = !flight.opening && !reducedMotion;
          flight = undefined;
          setMovingCamera(false);
        }
      }
      if (props.demonstration && !paused()) demoElapsed += delta;
      const demo = demonstrationFrame(demoElapsed);
      if (props.demonstration && Math.floor(demo.time * 10) !== lastUiTime) {
        setDemoTime(demo.time);
        lastUiTime = Math.floor(demo.time * 10);
      }
      for (const valve of valves) {
        const open = activeOutputs.includes(valve.mesh.userData.output)
          ? props.demonstration
            ? demo.valveOpening
            : 1
          : 0;
        valve.mesh.quaternion.copy(valve.closed).slerp(valve.opened, open);
      }
      const moving = props.demonstration
        ? demo.flowing
        : props.online && props.flowing;
      if (props.demonstration ? !paused() : !reducedMotion) motionTime += delta;
      if (moving)
        for (const map of liquidMaps)
          map.offset.set(motionTime * 0.018, motionTime * 0.011);
      if (flowParticles) {
        let index = 0;
        if (moving)
          for (const route of routes) {
            if (!activeGroups.includes(route.group) || route.length < 0.001)
              continue;
            const count = Math.max(1, Math.ceil(route.length / 0.22));
            for (let i = 0; i < count; i++) {
              const t = ((motionTime * 0.55) / route.length + i / count) % 1;
              position.lerpVectors(route.start, route.end, t);
              dummy.position.copy(position);
              dummy.position.y += 0.01;
              dummy.updateMatrix();
              flowParticles.setMatrixAt(index++, dummy.matrix);
            }
          }
        flowParticles.count = index;
        flowParticles.instanceMatrix.needsUpdate = true;
      }
      controls.update();
      if (valvePoint && inspectionReady()) {
        camera.updateMatrixWorld();
        const point = valvePoint.clone().project(camera);
        const x = (point.x * 0.5 + 0.5) * host.clientWidth;
        const y = (-point.y * 0.5 + 0.5) * host.clientHeight;
        // Limita ao canvas (host), não ao viewer, para não cobrir o painel da direita.
        const width = Math.min(340, host.clientWidth - 24);
        const height = popover?.offsetHeight || 360;
        const narrow = host.clientWidth < 580;
        const left = narrow ? (host.clientWidth - width) / 2 : Math.max(12, Math.min(x + 64, host.clientWidth - width - 12));
        const top = Math.max(12, Math.min(narrow ? y + 44 : y - 130, viewer.clientHeight - height - 12));
        const last = anchor();
        if (Math.abs(last.x - x) + Math.abs(last.y - y) + Math.abs(last.left - left) + Math.abs(last.top - top) > 0.5)
          setAnchor({ x, y, left, top });
      }
      renderer.render(scene, camera);
    });
    onCleanup(() => {
      destroyed = true;
      renderer.setAnimationLoop(null);
      resize.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", pointerDown);
      renderer.domElement.removeEventListener("pointerup", pointerUp);
      if (model) dispose(model);
      if (flowParticles) {
        flowParticles.geometry.dispose();
        (flowParticles.material as THREE.Material).dispose();
      }
      ground.geometry.dispose();
      ground.material.dispose();
      light.shadow.dispose();
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    });
  });

  createEffect(() => {
    if (!ready()) return;
    const def = props.scenario;
    const active = props.demonstration
      ? (def?.outputs ?? [])
      : props.online
        ? props.outputs
        : [];
    const color = new THREE.Color(
      ...((def?.color ?? [0.05, 0.55, 1]) as [number, number, number]),
    );
    const groups =
      def &&
      (props.demonstration ||
        (props.online && def.outputs.every((o) => active.includes(o))))
        ? def.groups
        : [];
    activeGroups = groups;
    activeOutputs = active;
    for (const mesh of meshes) {
      if (
        mesh.userData.structure ||
        ["Caixa_eletrica", "Cabo", "LED_bomba"].includes(mesh.name)
      )
        mesh.visible = false;
      if (mesh.name.startsWith("Jato_retorno_")) mesh.visible = false;
      const on =
        (mesh.userData.output && active.includes(mesh.userData.output)) ||
        groups.includes(mesh.userData.flow_group);
      for (const mat of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        mat.color.copy(mat.userData.baseColor);
        const indicator = on && /LED|rotulo/.test(mesh.name);
        mat.emissive.copy(indicator ? color : new THREE.Color(0));
        mat.emissiveIntensity = indicator ? 0.25 : 0;
      }
    }
  });

  return (
    <section ref={viewer} class={styles.viewer} aria-label="Modelo da estufa">
      <div ref={host} class={styles.canvas} />
      <Show when={!ready() || error()}>
        <p class={styles.modelMessage} role="status">
          {error() || "Carregando estufa 3D…"}
        </p>
      </Show>
      <aside class={styles.viewerControls} inert={!!props.selectedValve || movingCamera()} data-inspecting={!!props.selectedValve} aria-label="Controles da estufa">
      {/* Sempre no fluxo (só fica invisível) para o painel não se mover ao alternar o modo. */}
      <div class={styles.demonstrationTransport} style={{ visibility: props.demonstration && ready() ? "visible" : "hidden" }}>
          <div>
            <button
              aria-label={
                paused() ? "Reproduzir demonstração" : "Pausar demonstração"
              }
              onClick={() => setPaused(!paused())}
            >
              {paused() ? <Play size={14} /> : <Pause size={14} />}
            </button>
            <button
              aria-label="Reiniciar demonstração"
              onClick={() => {
                demoElapsed = 0;
                setDemoTime(0);
              }}
            >
              <RotateCcw size={14} />
            </button>
            <span>{paused() ? "Demonstração pausada" : frame().phase}</span>
          </div>
          <progress
            aria-label="Progresso da demonstração"
            max={DEMO_DURATION}
            value={demoTime()}
          />
        </div>
      <div class={styles.viewerTools}>
        <select
          aria-label="Controlar válvula"
          value=""
          onChange={(e) => {
            const value = e.currentTarget.value;
            e.currentTarget.value = "";
            if (value && !props.selectedValve && !flight) props.onValveSelect(value);
          }}
        >
          <option value="" disabled selected>
            Controlar válvula
          </option>
          <For
            each={["VA", "VAD1", "VAD2", "VG", "VL13", "VL46", "VRA1", "VRA2"]}
          >
            {(id) => <option value={id}>{id}</option>}
          </For>
        </select>
        <button
          aria-pressed={cameraView() === "overview"}
          title="Visão geral"
          onClick={() => view("overview")}
        >
          <Box size={14} /> Geral
        </button>
        <button
          aria-pressed={cameraView() === "top"}
          title="Vista superior"
          onClick={() => view("top")}
        >
          <PanelsTopLeft size={14} /> Superior
        </button>
        <button
          aria-pressed={cameraView() === "hydraulics"}
          title="Válvulas e bomba"
          onClick={() => view("hydraulics")}
        >
          <SlidersHorizontal size={14} /> Válvulas
        </button>
      </div>
      {props.children}
      </aside>
      <Show when={props.selectedValve && inspectionReady()}>
        <span class={styles.valveAnchor} style={{ left: `${anchor().x}px`, top: `${anchor().y}px` }} aria-hidden="true" />
        <div ref={popover} class={styles.valvePopover} style={{ left: `${anchor().left}px`, top: `${anchor().top}px` }}>
          {props.valvePanel}
        </div>
      </Show>
      <p class={styles.hint}>
        Arraste para girar · role para ampliar · selecione uma válvula
      </p>
    </section>
  );
}
