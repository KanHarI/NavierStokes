export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface AppState {
  isCore: boolean;
  ship: { position: Vec3; orientation: Quat; scale: number };
  movementSpeed: number;
  pointerLocked: boolean;
  near: number;
  far: number;
  focus: number;
  /** Horizontal field of view in degrees. */
  fov: number;
  blur: number;
  exposure: number;
  density: number;
  densityCompensation: boolean;
  colorMode: 'white' | 'speed';
  distanceSaturation: boolean;
  renderScale: number;
  time: number;
  timeMin: number;
  timeMax: number;
  playing: boolean;
  playbackSpeed: number;
  independentDust: boolean;
  dustSpeed: number;
  fps: number;
  particleCount: number;
  status: string;
  modelLabel: string;
  modelDescription: string;
  overflow: number;
  maxSpeed: number;
  loading: boolean;
  flowAvailable: boolean;
}

export interface Actions {
  reset(): void;
  reseed(): void;
  scrub(time: number): void;
  enterFlight(): void;
}

export function initialState(): AppState {
  const isCore = new URLSearchParams(location.search).get('field') !== 'exterior';
  return {
    isCore,
    ship: { position: isCore ? [0, -.6, .15] : [0, -2.4, 0.6], orientation: [0.627,-0.0,0.0,0.779], scale: isCore ? .25 : 1 },
    movementSpeed: 0.5, pointerLocked: false,
    near: 1, far: 3, focus: 2, fov: 65, blur: 6, exposure: 0,
    density: 500, densityCompensation: false, colorMode: 'white',
    distanceSaturation: false, renderScale: 1,
    time: 0, timeMin: 0, timeMax: 0.9, playing: false, playbackSpeed: 0.02,
    independentDust: false, dustSpeed: 0.1,
    fps: 0, particleCount: 0, status: 'Loading precomputed fields…',
    modelLabel: 'Scientific preview', modelDescription: 'Loading the dataset scope and validity limits.',
    overflow: 0, maxSpeed: 1, loading: true, flowAvailable: false,
  };
}
