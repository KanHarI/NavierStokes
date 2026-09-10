# Implementation plan

## 1. Status, objective, and authorization

This document records the agreed design and proposed order of implementation. On September 9, 2026 the user authorized implementation and subagents. The repository now contains separate local-core and heat-exterior scientific checkpoints and a WebGL 2 prototype; see README.md for the runnable commands and actual feature inventory. Requirements and exit conditions below remain targets unless explicitly reported as validated.

The objective is a hosted browser experience in which a freely moving, resizable spacecraft explores precomputed fluid fields through luminous tracer particles. The first scientific target is a documented numerical reconstruction of the source paper's leading flow, not a claim to reproduce the complete corrected construction or to prove blowup numerically.

The user has authorized writing these documents, creating a public GitHub repository, installing the `grill-me` planning skill with its required dependency, and starting application/numerical implementation with subagents. Ordinary work within this scope should proceed without repeatedly requesting approval. Revisit scope if a faithful leading-flow implementation cannot meet the agreed constraints; do not silently substitute an unrelated vortex.

### Current checkpoint

A procedural cinematic arrival generates fresh 5–30-second linear-time approaches, replacing the fixed four-view sequence and progressively slower repeats. Camera angles, roll, orbit, magnification, perspective, field of view, focus, radar depth, bokeh, ISO, and particle density vary within coupled framing bounds. Each clip reaches the finite endpoint and fades to black before restarting. The final rendering is monochrome; parallax, focus, and normalized flow-aligned motion exposure provide depth. A persistent Hide controls / Show controls button clears the cockpit without stopping playback. Click to look around enables mouse steering and relative WASD and Up/Down arrow movement, QE roll, and ZX radar range during playback; each new clip resets these adjustments. Space takes over manual flight. A game HUD replaces descriptive text after clicking to look. Escape releases capture and returns to procedural viewing in one press. At each endpoint the completed image fades without further particle updates, followed by a black frame before reset. This presentation does not change the represented fluid equations or complete the remaining scientific work.

The default view now adds continuous surroundings to the computed core: Appendix B.22 reference continuation, a streamfunction join to the heat exterior, a matched radial pressure moment, and smooth physical localization to stationary fluid. See docs/extended-flow.md for the equations and remaining source conditions. The renderer reconstructs both meridional components from a common bicubic primitive, keeps dust in stationary fluid, and removes the old shrinking data crop from this default mode. The two original isolated checkpoints remain selectable.

The underlying core checkpoint reconstructs a convergent local solution of the actual coupled leading core equations (4.13/B.15), with diagnostic analytic axis pressure and finite parameters. The radial Taylor solver, independent physical residual checks, and 129 × 257 compressed-coordinate table are implemented. The preview ends at t=0.9999, occupies about 544 KB, and generates in about 23 seconds. See docs/core-mathematics.md, docs/core-parameters.md, and docs/validation/science-core.md.

Global matching remains open. In particular, the selected broad angular parameter fails a continuation gate in Appendix B, and the pressure is a local diagnostic datum rather than the outer-matched schedule. The existing heat exterior remains a separate selectable checkpoint. None of these checkpoints is presented as a globally assembled leading vortex or the complete corrected construction. The next scientific work is constructive outer scheduling, admissible continuation parameters, and annular matching with their measured stress conditions.

The small generator and browser do not exhaust the final one-hour computation budget. No full high-resolution run has been performed. GitHub Pages now publishes the static build from main; the requested custom domain is pending DNS setup. The first checkpoint does not complete Milestone 1's full leading-flow feasibility requirement or authorize labeling the viewer a completed blowup simulation.

## 2. Requirements and boundaries

### Agreed requirements

- Offline generation on the user's M3 Pro Mac with 36 GB RAM.
- An early, low-resolution preview before expensive computation.
- An approximately one-hour cap for the final generation run.
- A complete high-resolution dataset of at most 100 MB, with a preview below 5 MB.
- A static hosted application using WebGL 2; no server computation during playback.
- Full local-axis translation and rotation, without a preferred world up direction.
- Positive multiplicative ship scale, initially coupled to travel speed and viewing distances.
- Finite perspective and independently adjustable field of view.
- A spherical visibility shell with near/far defaults of 2 and 4 ship-scale units, focused at 3, with smooth transitions from 1 to 2 and 4 to 5.
- Per-particle Gaussian defocus that conserves integrated light.
- Excess pixel luminance redistributed as white light, with measured conservation.
- Manual global ISO/exposure and independently adjustable dust density.
- White dust by default; optional blue-to-red speed color and distance-based saturation.
- Local particle simulation with hidden buffers, recycling, and smooth replenishment.
- Simulation playback and dust transport that can run together or independently.
- Reseeding with a short transition after time scrubbing.
- A public repository with explicit scientific limitations and reproducible datasets.

### Not promised for the first release

- Full numerical realization of the infinite correction hierarchy.
- A direct numerical simulation from rest of the complete forced solution.
- Reaching or continuing through the singular time.
- Resolving structures finer than the represented dataset.
- Persistent identities for dust outside the local simulation region.
- Mobile controls, VR, physical spacecraft inertia, or a separate radar instrument.
- Automatic exposure or coupled camera presets before independent controls are usable.

The term “radar” currently means the main view's spherical observation shell. A separate instrument is not part of the initial scope.

## 3. Scientific feasibility and model definition

### 3.1 Source traceability

Use the [source post](https://openai.com/index/navier-stokes-solution/), [paper](https://cdn.openai.com/pdf/32d9f210-8b73-45e0-91bc-82a30aef8a9a/navier-stokes.pdf), and [formalization repository](https://github.com/openai/NavierStokesAndEuler) as references. Record retrieval dates, a paper checksum, and any formalization commit consulted so later upstream changes are visible.

Read the relevant construction and appendices in detail before translating equations. Produce a mathematical specification that maps every implemented profile, parameter, transform, and force calculation to its source equation or explicitly identifies it as a numerical choice.

### 3.2 Questions the first checkpoint must resolve

1. Which profile equations are explicit, and which require a boundary-value solve or constructive choices?
2. What admissible parameter choices can be instantiated numerically?
3. How are the axis, exterior, and transition regions treated without introducing artificial singularities?
4. Which part of the flow and which pre-singularity time interval are represented?
5. Which corrections are omitted, and how does that affect the computed forcing?
6. Does the selected approximation include a justified startup from rest? If not, start playback at its valid positive time and say so.
7. Can a compact representation meet both field and derivative accuracy needs?

Do not impose reflection symmetry across the axial midplane merely because the flow looks approximately symmetric. Use only symmetries actually satisfied by the selected construction. Axisymmetry applies to the proposed leading component and must not be assumed for later angular disturbances.

### 3.3 Field definitions and units

Begin with an explicitly documented nondimensional formulation:

```text
partial_t u + (u dot grad)u = -grad p + nu laplacian(u) + f
div u = 0
```

Here pressure is the pressure divided by constant density, and f is external force per unit mass. Store or derive unambiguous names for:

- Velocity u and normalized pressure p.
- Local acceleration partial_t u.
- Advective contribution (u dot grad)u.
- Pressure acceleration -grad p.
- Viscous acceleration nu laplacian(u).
- External acceleration f.
- Material acceleration, equal to the sum of pressure, viscous, and external contributions.
- Vorticity and numerical diagnostics where useful.

Advection is not an additional external force. A physical force for a voxel requires a density and physical unit conversion; only then is rho times voxel volume times f a force in newtons. Default UI values should remain in labeled simulation units until physical scales are provided.

If f is defined as the computed momentum residual, the resulting identity is not independent evidence of accuracy. Validate the underlying profile equations, incompressibility, transforms, derivatives, convergence, and applicable integral balances separately. Distinguish the approximation's required forcing from the full construction's smooth forcing.

### 3.4 Numerical approach

- Use Python with double precision for construction and reference evaluation; select numerical dependencies after inspecting the equations.
- Solve and tabulate in the coordinates natural to the profile, then reconstruct physical Cartesian fields through a tested transform.
- Treat axis limits analytically where possible, rather than dividing by a small radius.
- Prefer analytic derivatives or derivatives of a smooth fitted representation over differencing quantized browser data.
- Explore a streamfunction representation for the meridional flow if it preserves incompressibility more accurately than separately interpolated velocity components.
- Concentrate spatial samples where profile variation requires them. If snapshots are needed, sample increasingly close times using log time-to-singularity, with a finite endpoint.
- Stop or mark invalid any query outside the certified domain or represented scales. Do not silently extrapolate.

### Checkpoint A: feasibility acceptance

Deliver a source-linked mathematical specification, reference evaluator, small field sample, diagnostic plots, and runtime measurements. State measured errors and unresolved limitations. A valid field sample must have finite values throughout its declared domain and demonstrate improving errors under refinement. Set concrete release tolerances from this evidence before generating the final dataset.

An independently evolved Navier–Stokes comparison is a later validation option if a consistent forcing, domain, and initial/boundary data can be prescribed. It is not a prerequisite for the initial visualization and must not be confused with the full construction.

## 4. Dataset architecture

### 4.1 Compact representation

For the axisymmetric component, tabulate radial and axial coordinates plus all three cylindrical velocity components. At a Cartesian query, compute the cylindrical location, sample the profiles, and rotate the vector back into the Cartesian basis.

Factor known time-dependent coordinate and amplitude scales out of stored values. Reuse fixed profiles where mathematically justified instead of storing redundant snapshots. Represent remaining time variation with validated interpolation or additional snapshots.

For later non-axisymmetric additions, investigate sparse angular Fourier modes or pulse parameters. Retain them only if truncation and browser evaluation errors can be measured. Compression is not permission to remove scientifically necessary structure without disclosure.

### 4.2 Manifest contract

The versioned manifest should declare:

| Category | Required information |
| --- | --- |
| Identity | Schema version, dataset ID, source/code versions, generation configuration |
| Scientific scope | Implemented model, omitted corrections, viscosity, units, symmetry assumptions |
| Coordinates | Grid axes, transforms, basis conventions, axis limits, domain bounds |
| Time | Valid interval, singular time reference, snapshot times or profile scaling functions |
| Channels | Names, component ordering, units, optional/required status |
| Encoding | Shape, byte order, numeric type, block scales/offsets, compression |
| Chunks | URLs, checksums, compressed and decoded sizes, resolution levels, dependencies |
| Validation | Error summaries, reference norms, valid query limits, generation duration |

Use small independently fetchable chunks so optional force inspection does not delay initial dust playback. Distinguish network size from decoded CPU and GPU memory. Set and enforce a bounded cache after profiling.

### 4.3 Precision and loading

- Keep reference construction in float64.
- Evaluate float32 and block-scaled 16-bit export against the reference, using normalized absolute errors and relative errors away from zeros.
- Assess derivative and force errors independently of velocity errors. Small net force obtained from large cancelling terms needs special care.
- Export accurately computed net forcing separately; do not subtract compressed force contributions to recover it in the browser.
- Measure coordinate mapping, interpolation, quantization, and temporal errors as separate contributions.
- Count the preview, optional channels, and every shipped resolution level toward the 100 MB complete dataset limit; exclude local reference outputs that are not shipped.
- Target the preview dataset below 5 MB and report the application bundle separately.
- Load manifest and coarse velocity first, then refine. Pause time advancement when required data is unavailable rather than advecting through missing fields.
- Blend between resolution levels when necessary to avoid visible jumps, and validate the effect on the sampled field.

### Checkpoint B: export acceptance

Produce a reproducible preview dataset, manifest validator, budget report, and reference-versus-decoded comparison. Every browser-required query must be covered by the declared data. The format must accommodate higher resolution without changing the navigation or rendering code.

## 5. Browser architecture and navigation

### 5.1 Proposed modules

| Module | Responsibility |
| --- | --- |
| Dataset loader | Manifest validation, decompression, chunk cache, GPU uploads |
| Field sampler | Coordinate transforms, time interpolation, vector reconstruction, domain checks |
| Ship state | Position, quaternion orientation, log scale, movement/rotation rates |
| Optics state | Field of view, visibility shell, focus, blur, exposure |
| Simulation clock | Time, playback rate, pause, scrubbing, valid endpoint |
| Dust system | GPU integration, seeding, recycling, density, transport modes |
| Renderer | Gaussian lights, HDR accumulation, redistribution, display encoding |
| Interface | Controls, help, loading state, units, scientific scope, performance indicators |

Use TypeScript with a lightweight build and UI setup, choosing exact packages at implementation time. Keep WebGL resources explicitly owned and disposable. Handle resize and context loss without corrupting playback state.

### 5.2 Flight behavior

Continuous orientation lies in SO(3); translation plus orientation in SE(3); adding positive uniform scale gives the similarity-group viewpoint. Implement this using position, a normalized quaternion, and log scale. Reflections are unnecessary.

Integrate input using elapsed time. Apply angular increments about local axes, normalize simultaneous translation inputs to avoid diagonal speed boosts, and periodically renormalize orientation. Initially use direct velocity control without spacecraft inertia.

| Input | Default action |
| --- | --- |
| Mouse | Local yaw/pitch while pointer is captured |
| W/S, A/D, ↑/↓ | Forward/backward, left/right, local up/down |
| Q/E | Roll left/right |
| Z/X | Decrease/increase log observation scale |
| Shift | Temporary translation boost |
| Space | Toggle simulation play/pause |
| Escape | Release pointer capture |

Keyboard shortcuts must not fire while editing interface fields. Reset input state on focus loss so the ship cannot continue moving from a stuck key.

Changing scale initially leaves the world-space ship position unchanged. Travel speed is proportional to ship scale, multiplied by a user-adjustable base speed. Near/far/focus distances are positive multiples of ship scale. Keep field of view independent and safely bounded away from degenerate projection values.

Use camera-relative positions and appropriate scaled representations on the GPU. Preserve sufficient CPU precision for navigating near the core. Do not let purely visual scale imply scientific detail absent from the dataset.

### 5.3 Optics and coupled moves

The visibility shell is spherical, while the camera uses a perspective frustum. Implement shell visibility in radial distance; do not substitute the camera's planar near/far clipping distances. Configure geometric clipping so it does not incorrectly cut the visible part of the shell, especially at wide field of view.

Expose near/far shell multiples, focus distance, blur strength, ISO, field of view, and edge-fade width. Enforce near < far and positive focus distance. Use near = 2, far = 4, focus = 3, and transition width = 1 (updated user preference). Full opacity applies inside the near/far interval; smooth fading and additional Gaussian bokeh extend outside it. A further invisible guard contains ordinary particle births and recycling.

Later presets may coordinate retreat, rendering distances, and field of view around an explicit selected target. Doubling shell distances alone does not preserve a subject's apparent size. A dolly zoom needs a target and corresponding field-of-view adjustment.

## 6. Simulation clocks and local dust

### 6.1 Time semantics

Let playback wall time be w, simulation time be t, simulation playback rate be alpha, and dust transport factor be beta:

```text
dt/dw = alpha
dx/dw = beta * u(x, t)
```

In physically synchronized playback beta = alpha, with consistent unit conversion. Pausing in this mode sets both to zero. Independent transport mode allows beta to remain positive while alpha = 0, or to differ from alpha. Clearly indicate this exploratory mode because its paths are not the time-dependent fluid's physical trajectories.

Scrubbing sets t and reseeds dust with a short transition. Do not integrate through every intermediate time to service a jump. Forward playback is required initially; reverse playback is not implied by having a time slider. At the dataset's endpoint, stop progression rather than extrapolating to the singular time.

### 6.2 Particle domain and lifecycle

- Maintain particles in a full spherical annulus plus inner/outer guard bands, not just the current view frustum.
- Select guard-band width using the particle/ship travel possible over an update horizon, within a bounded resource budget.
- Retain in-buffer particles during ordinary flight and time progression.
- Seed newly uncovered volume and incoming flow so visibility does not depend on chance boundary crossings.
- Recycle particles leaving the buffer or valid field domain; do not wrap them across the scientific domain.
- Sample uniformly by volume when uniform density is intended; radius must not be sampled uniformly in a spherical shell.
- Change density gradually, accounting for shell volume changes. Replenishment must not create apparent fluid compression.
- Crossfade after large camera/scale jumps and time scrubs using complementary weights so overlapping populations do not double brightness.
- Use deterministic seeds for repeatable testing; do not promise global persistent dust identities.

The target is particles per ship-scale volume. Impose an explicit particle cap independent of requested density, and show when a limit is reached. Per-particle light stays fixed by default. Optional density compensation follows the requested density ratio, with bounded behavior near zero density.

### 6.3 GPU integration

Use WebGL 2 transform feedback or a measured equivalent to keep particle state on the GPU. Begin with midpoint/RK2 integration and adaptive substep counts chosen from local scale, speed, and field resolution. Compare against a higher-accuracy CPU trajectory reference on representative paths.

Large dust-speed settings must not silently violate integration accuracy. Cap or slow transport when the allowed per-frame substeps are exhausted and report the condition. Fixed or bounded simulation steps should make paths insensitive to ordinary frame-rate variation.

### Checkpoint C: navigation and dust acceptance

Users can explore the preview in any orientation and scale without horizon locking or coordinate jitter. Pause, independent dust transport, and scrubbing follow the defined semantics. Rotation does not uncover empty dust regions. Tests demonstrate stable density, integration convergence, and correct field-domain handling.

## 7. WebGL light pipeline

### 7.1 Gaussian particle rendering

Render instanced camera-facing patches rather than relying on implementation-limited large point sizes. Each patch evaluates a radial Gaussian in screen space:

```text
I(r) = L / (2*pi*sigma^2) * exp(-r^2 / (2*sigma^2))
```

Truncate the profile at a documented multiple of sigma and renormalize for the truncated support. Apply a minimum resolved sigma and account for pixel sampling near that minimum. A candidate defocus law is sigma = sqrt(sigma_min^2 + [K * abs(1/d - 1/d_focus)]^2), where distances use ship-scale units. Tune this law visually; it is an artistic spherical-focus model, not an exact lens simulation.

The emitter model uses controlled tracer light with an angular-to-image-area conversion, rather than an unspecified physical inverse-square law. A perspective pixel covers a different solid angle depending on its off-axis angle; the renderer includes the corresponding inverse Jacobian before Gaussian normalization to avoid a camera-centered brightness bias in uniform angular dust. Defocus conserves this weighted per-particle light. The FOV control explicitly specifies horizontal degrees. See docs/validation/projection.md for the calibration and its scope. A distance attenuation mode could be added later as a separate choice. Shell-edge fading is a deliberate visibility effect and is measured separately from blur conservation.

Accumulate light additively in a linear floating-point render target. Verify the exact target and blending capabilities on startup; float rendering support alone does not guarantee every desired format/operation combination. Use a tested half-float path if suitable, and measure finite-range accumulation limits.

### 7.2 ISO and overflow redistribution

1. Apply a global manual exposure multiplier, preferably presented in stops with an ISO-like relative value.
2. Separate displayable light from excess using a defined display-linear luminance budget.
3. Preserve the displayable portion and redistribute excess as neutral white light through normalized Gaussian kernels.
4. Repeat at increasing radii when receivers overflow, within an explicit pass budget.
5. Account for any unresolved excess; never silently treat dropped residual light as conserved.
6. Convert to display encoding after redistribution. Do not introduce an unmeasured filmic tone curve that defeats the stated conservation property.

For colored particles, perform the accounting in linear luminance, with explicit gamut handling. Converting colored excess to white preserves the chosen luminance quantity, not all individual RGB channel totals. Define the display capacity conservatively so apparently saturated colors do not bypass the overflow calculation.

Use boundary-normalized redistribution so light already in the image is not lost at screen edges. Separately handle particle footprints extending across the viewport with sufficient guard area or correct clipping; offscreen emitters are not all automatically part of the visible image's brightness budget.

If total light exceeds the whole display's capacity, conservation into a bounded image is impossible. Show overexposure, retain manual ISO authority, and keep optional automatic exposure out of the initial implementation. Report unresolved excess in diagnostics. Global exposure changes are intentional changes in represented light.

### 7.3 Color and performance

- Default to neutral white lights and a dark background.
- Offer speed hue with configurable bounds and optional logarithmic normalization; blue denotes lower speed and red higher speed.
- Keep normalization stable during playback unless the user selects an automatic mode.
- Offer distance saturation independently, with its mapping and direction adjustable. It has no visible effect on monochrome white until color is enabled.
- Start at a modest particle count and measure frame time at a stated viewport resolution and device pixel ratio.
- Expose density, rendering resolution, and maximum blur work as separate quality controls.
- Investigate lower-resolution processing for broad halos only after a correct reference implementation; validate conservation across resampling.
- Do not silently reduce scientific dataset resolution to maintain rendering speed.

### Checkpoint D: optics acceptance

Render diagnostic scenes with isolated points, overlap, sharp/blurred mixtures, edges, different resolutions, and colored overflow. Measure integrated light before/after blur and redistribution. Test the full-screen saturation exception explicitly. Benchmark Safari and Chromium on the target Mac, aiming for 60 fps at a documented desktop setting and reporting the setting actually achieved.

## 8. Scientific inspection and interface

Keep the initial page focused on the experience: a visible start action, compact control panel, help overlay, and reset view. Explain that the field is a leading-flow approximation without requiring users to read implementation details to navigate.

Group controls by flight, optics, dust, and time. Allow reset per group and a complete reset. Distinguish changing ship scale from changing field of view and from advancing simulation time.

A later inspection mode should freeze/select a world point and display velocity, pressure, force contributions, units, and applicable uncertainty. It need not expose a literal dense voxel grid: a compact field representation can answer point queries and export voxel samples on demand.

Show loading, invalid-domain queries, scientific resolution limits, and overexposure when relevant. Save settings locally only after defining a versioned, bounded settings format. Avoid excessive explanatory text over the main view.

## 9. Validation and budgets

| Layer | Validation evidence |
| --- | --- |
| Profiles | Source mapping, parameter admissibility, equation residuals, refinement behavior |
| Physical reconstruction | Axis limits, coordinate transforms, divergence, applicable energy/boundary balances |
| Export | Round-trip error, quantization/interpolation breakdown, checksums, byte budgets |
| Browser sampling | CPU/GPU agreement at grid points and off-grid queries, time/scale extremes |
| Dust | Reference trajectories, frame-rate sensitivity, pause/scrub semantics, density statistics |
| Navigation | Local-axis behavior, quaternion stability, scale changes, pointer/focus handling |
| Light | Gaussian normalization, exposure scaling, overlap, redistribution, edges, saturation limits |
| Runtime | Startup transfer, decoded/GPU memory, frame time, load stalls, cleanup/context recovery |

Set numerical pass/fail thresholds after Checkpoint A establishes the relevant reference scales. Near-zero quantities need absolute or normalized norms rather than unstable relative errors. Reports must state what norm, region, and time range were measured. Keep visual tolerances and scientific tolerances separate.

Choose meaningful tests of invariants and behavior, not tests that merely repeat implementation expressions. Run lightweight validation in CI; do not run the hour-long generator on every commit. Preserve a small deterministic preview fixture and reference samples for regression checks.

Before the final run, estimate duration and size from smaller runs, select a configuration with margin, and support checkpointed or bounded completion. The pipeline must not silently lower quality and still label the result as the selected configuration. Publish a report of actual elapsed time, byte size, configuration, and measured errors.

## 10. Repository and hosting

Proposed layout after implementation approval:

```text
README.md
IMPLEMENTATION_PLAN.md
AGENTS.md
THIRD_PARTY_NOTICES.md
.agents/skills/           Installed grill-me and grilling planning skills
science/
  src/                  Profile construction and export pipeline
  configs/              Preview and final-run configurations
  tests/                Numerical and format validation
web/
  src/                  UI, navigation, loaders, particle system
  shaders/              Sampling, integration, light, redistribution
  tests/                Behavioral and rendering checks
datasets/
  schema/               Manifest specification
  preview/              Small distributable fixture
docs/
  mathematics.md        Equations, choices, and omitted corrections
  controls.md           Navigation and independent/coupled settings
  validation/           Numerical and rendering reports
```

Create dependency manifests, build commands, CI, ignore rules, and a project code license only during implementation. Choose a code license deliberately; public visibility alone does not grant an open-source license. The installed third-party planning skills retain their MIT license in THIRD_PARTY_NOTICES.md; that notice does not license the rest of this project. Link to upstream source material and check its license before copying any code or assets.

Use the public GitHub source repository for code, documentation, and small fixtures. Store full generated datasets outside routine Git history and assemble them into versioned static hosting artifacts. Avoid a large monolithic file when small independently fetchable chunks work.

GitHub Pages is the initial hosting candidate. Verify path handling, MIME types, compression strategy, caching, and published-size/traffic limits before adopting it. If later traffic or delivery requirements exceed its limits, retain the same static application and move dataset delivery to object storage/CDN. Creating the repository is not authorization to publish an unreviewed application now.

## 11. Execution order and decision checkpoints

| Milestone | Concrete result | Exit condition |
| --- | --- | --- |
| 0 — Documentation | README, this plan, planning skills, public repository | Complete; subsequent implementation authorized |
| 1 — Mathematical feasibility | Source-linked specification, reference evaluator, small sample | Checkpoint A; approximation is credible and limitations explicit |
| 2 — Preview export | Compact manifest/chunks, decoder reference, error/size report | Checkpoint B; preview below 5 MB |
| 3 — Interactive flow | Flight, scale, time, local GPU dust, basic white rendering | Checkpoint C on preview data |
| 4 — Optical behavior | Gaussian defocus, ISO, conservative overflow, optional colors | Checkpoint D with measured brightness accounting |
| 5 — Refined dataset | Bounded final generation and complete validation report | Run and dataset budgets met; selected numerical tolerances pass |
| 6 — Hosted release | Static build, documentation, reproducible release artifact | Browser checks pass; hosting target selected and release reviewed |

Scientific feasibility and the basic dataset interface come before polishing visuals. Milestones 3 and 4 should be usable with the small preview so interaction can be refined without regenerating the final dataset. The user explicitly authorized subagents for implementation; use bounded independent tasks with clear file ownership.

Revisit the scope if the profile construction is not computationally accessible, the approximation's field cannot be validated, or the required accuracy cannot fit the compute/data budgets. Routine implementation details such as panel layout, exact particle counts, shader pass counts, and package versions can be decided through measured iteration within the authorized scope.

## 12. Technical references

- [WebGL 2 transform feedback](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext/transformFeedbackVaryings): GPU particle state updates.
- [EXT_color_buffer_float](https://developer.mozilla.org/en-US/docs/Web/API/EXT_color_buffer_float): floating-point render-target capabilities; verify blending and chosen formats separately.
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits): check current hosting constraints when preparing deployment.

These are implementation references, not guarantees of support on every browser or device. Runtime capability checks and target-machine measurements remain required.
