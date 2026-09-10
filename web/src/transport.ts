/** Bounded particle work without changing the requested simulation clock. */
export const MAX_TRANSPORT_STEPS = 4096;
export const CORE_STEP_FRACTION = .0025;
const EXTERIOR_STEP = .0025;

export interface TransportRequest {
  isCore: boolean;
  tauEnd: number;
  timeDelta: number;
  transportDelta: number;
  /** Smaller values are useful for convergence checks. */
  coreStepFraction?: number;
  maxSteps?: number;
}

export interface TransportPlan {
  steps: number;
  requiredSteps: number;
  requestedDelta: number;
  actualDelta: number;
  timeDelta: number;
  tauStart: number;
  tauEnd: number;
  reseed: boolean;
  limited: boolean;
  reason: 'integration-budget' | 'frozen-dust-budget' | null;
  geometricDecay: number;
  firstWeight: number;
}

/** Slow the viewer clock before submitting an expensive mobile interval.
 * Field time and tracer time keep the same ratio; no trajectory is discarded.
 * One spare step below the renderer's guard absorbs endpoint rounding.
 */
export function limitTransportFraction(request: TransportRequest, maxSteps = 127): number {
  // Reuse the planner's input validation without its endpoint reseed policy.
  planTransport({ ...request, maxSteps });
  const { timeDelta, transportDelta, tauEnd, isCore } = request;
  if (timeDelta === 0 || transportDelta === 0) return 1;
  const ratio = Math.max(1, Math.abs(transportDelta / timeDelta));
  const fraction = request.coreStepFraction ?? CORE_STEP_FRACTION;
  const allowedDelta = isCore
    ? (tauEnd + timeDelta) * -Math.expm1(-maxSteps * Math.log1p(fraction / ratio))
    : maxSteps * EXTERIOR_STEP / ratio;
  return Math.min(1, allowedDelta / timeDelta);
}

/**
 * Advancing core fields use geometric spacing in remaining physical time.
 * The sum of all physical substeps is exactly the requested time interval;
 * transport uses the same weights, including independent dust multipliers.
 * A frame too large to resolve replaces tracers at the requested endpoint.
 * Only transport through a frozen field may be shortened, explicitly.
 */
export function planTransport(request: TransportRequest): TransportPlan {
  const { isCore, tauEnd, timeDelta, transportDelta } = request;
  const fraction = request.coreStepFraction ?? CORE_STEP_FRACTION;
  const maxSteps = request.maxSteps ?? 256;
  if (![tauEnd, timeDelta, transportDelta, fraction].every(Number.isFinite)
      || tauEnd <= 0 || timeDelta < 0 || fraction <= 0 || fraction > CORE_STEP_FRACTION
      || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_TRANSPORT_STEPS) {
    throw new Error('Invalid particle integration request.');
  }
  const plan: TransportPlan = {
    steps: 0, requiredSteps: 0, requestedDelta: transportDelta, actualDelta: transportDelta,
    timeDelta, tauStart: tauEnd + timeDelta, tauEnd,
    reseed: false, limited: false, reason: null, geometricDecay: 0, firstWeight: 0,
  };
  if (!Number.isFinite(plan.tauStart)) throw new Error('Invalid particle integration interval.');
  if (transportDelta === 0) return plan;
  const logRatio = isCore && timeDelta > 0 ? Math.log1p(timeDelta / tauEnd) : 0;
  const transportRatio = timeDelta > 0 ? Math.abs(transportDelta / timeDelta) : 1;
  // Frozen exploratory dust keeps its earlier, smaller per-frame workload.
  // This cap never participates in advancement of the simulation clock.
  const frozenStep = isCore ? Math.min(fraction, .001) * tauEnd : EXTERIOR_STEP;
  const availableSteps = timeDelta === 0 ? Math.min(maxSteps, 12) : maxSteps;
  const requiredSteps = logRatio > 0
    ? Math.max(1, Math.ceil(logRatio / Math.log1p(fraction / Math.max(1, transportRatio))))
    : Math.max(1, Math.ceil(timeDelta === 0 ? Math.abs(transportDelta) / frozenStep
      : Math.max(Math.abs(transportDelta), timeDelta) / EXTERIOR_STEP));
  plan.requiredSteps = requiredSteps;
  if (requiredSteps > maxSteps && timeDelta > 0) {
    // There is no defensible short trajectory spanning this whole interval.
    // Move the field clock normally and replace its local tracer samples.
    plan.actualDelta = 0;
    plan.reseed = true;
    plan.reason = 'integration-budget';
    return plan;
  }
  plan.steps = Math.min(requiredSteps, availableSteps);
  if (requiredSteps > availableSteps) {
    plan.actualDelta = Math.sign(transportDelta) * availableSteps * frozenStep;
    plan.limited = true;
    plan.reason = 'frozen-dust-budget';
  }
  plan.geometricDecay = logRatio / plan.steps;
  // expm1 avoids cancellation when the requested field-time interval is tiny.
  plan.firstWeight = logRatio > 0
    ? Math.expm1(-plan.geometricDecay) / Math.expm1(-logRatio)
    : 1 / plan.steps;
  return plan;
}

/** Reference for the exact substep construction used by the GPU shader. */
export function transportSubstep(plan: TransportPlan, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= plan.steps) throw new Error('Invalid transport substep.');
  const decay = Math.exp(-plan.geometricDecay * index);
  const weight = plan.firstWeight * decay;
  const tau = plan.geometricDecay > 0 ? plan.tauStart * decay
    : plan.tauStart - plan.timeDelta * index / plan.steps;
  const fieldDelta = plan.timeDelta * weight;
  return { tau, midpointTau: tau - fieldDelta / 2, fieldDelta, transportDelta: plan.actualDelta * weight };
}
