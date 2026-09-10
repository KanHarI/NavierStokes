export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface AppState {
  isCore: boolean;
  fieldKind: 'core' | 'exterior' | 'extended';
  introActive: boolean;
  hudActive: boolean;
  screensaver: boolean;
  touchControls: boolean;
  touchSettings: boolean;
  gyroActive: boolean;
  gyroPending: boolean;
  gyroStatus: string;
  introShot: number;
  introProgress: number;
  introDuration: number;
  introTitle: string;
  introCaption: string;
  introSpeedRatio: number;
  introScaleRatio: number;
  ship: { position: Vec3; orientation: Quat; scale: number };
  movementSpeed: number;
  boosting: boolean;
  pointerLocked: boolean;
  near: number;
  far: number;
  focus: number;
  shellFade: number;
  shellBokeh: number;
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
  timeMode: 'linear' | 'logarithmic';
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
  startIntro(): void;
  stopIntro(): void;
  reset(): void;
  reseed(): void;
  scrub(time: number): void;
  lookAround(): void;
  startScreensaver(): void;
  enterFlight(): void;
  returnToAuto(): void;
  toggleGyro(): void;
}

export function initialState(): AppState {
  const requested = new URLSearchParams(location.search).get('field');
  const fieldKind = requested === 'core' || requested === 'exterior' ? requested : 'extended';
  const isCore = fieldKind !== 'exterior';
  return {
    isCore, fieldKind,
    introActive: false, hudActive: false, screensaver: false,
    touchControls: matchMedia('(pointer: coarse)').matches, touchSettings: false,
    gyroActive: false, gyroPending: false, gyroStatus: '',
    introShot: 0, introProgress: 0, introDuration: 0, introTitle: '', introCaption: '',
    introSpeedRatio: 1, introScaleRatio: 1,
    ship: { position: isCore ? [0, -.6, .15] : [0, -2.4, 0.6], orientation: [0.627,-0.0,0.0,0.779], scale: isCore ? .25 : 1 },
    movementSpeed: 0.5, boosting: false, pointerLocked: false,
    near: 2, far: 4, focus: 3, shellFade: 1, shellBokeh: 24, fov: 65, blur: 6, exposure: 0,
    density: 500, densityCompensation: false, colorMode: 'white',
    distanceSaturation: false, renderScale: 1,
    time: 0, timeMin: 0, timeMax: 0.9, timeMode: 'linear', playing: false, playbackSpeed: 0.02,
    independentDust: false, dustSpeed: 0.1,
    fps: 0, particleCount: 0, status: 'Loading precomputed fields…',
    modelLabel: 'Scientific preview', modelDescription: 'Loading the dataset scope and validity limits.',
    overflow: 0, maxSpeed: 1, loading: true, flowAvailable: false,
  };
}
