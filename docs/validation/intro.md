# Procedural approaches to the concentrating core

The arrival sequence is rendered live in WebGL using the same precomputed
field and particle integrator as exploration. It generates an endless series
of independent **5–30-second clips**, all in **white light**. A fresh random
seed is chosen on arrival and on Replay. The integer-seeded generator is
reproducible for testing; there is no fixed set of movies or four-view cycle.
The previous progressively slower repeats have been replaced by bounded
random durations.

The first clip starts at the dataset's initial time. Later clips draw a
continuous magnification between the full interval and its last thousandth.
Their captions identify the actual starting and ending times. Each has a
0.35-second fade-in, linear physical-time progression for duration minus
0.70 seconds, and a 0.35-second fade-out of the final rendered image. Every
clip reaches t=0.9999 before restarting. The renderer completes its initial
GPU work before starting each clip's clock. At the endpoint it completes
the final GPU frame before starting a separate fade clock. No particles,
camera settings, or motion footprints change during that fade. One black
presentation precedes the next reset, and excess frame time is not carried
into the new clip. This removes the old 300 ms post-endpoint hold and the
possibility of a costly integration step skipping the whole transition.
The configured 5–30 seconds excludes unavoidable GPU stalls. Background-tab
time does not advance.

## Loading

The first HTML includes a monochrome snow overlay with an embedded SVG dot
tile and CSS-only drift. It needs no downloaded image, JavaScript, or WebGL
context. Reduced-motion preferences disable the drift. Startup reports
loading flow data and preparing the view separately, and hides the overlay
only after completing the first GPU frame. Debug startup timestamps separate
download/decode, renderer creation, and first-frame preparation.

## Camera, depth, and light

Each clip independently chooses azimuth, elevation, orbit direction and
extent, roll, magnification, zoom rate, perspective, field of view, focus,
front/back shell depth, fade width, Gaussian bokeh, ISO, and dust density.
Elevation is sampled uniformly in its sine within a pole-safe range, so
views cover both hemispheres without a preferred viewing axis. Smooth
interpolation keeps camera and optical changes continuous within a clip.

These choices are coupled: the core stays at the spherical focus distance;
perspective changes move the observer and shell distances together while
compensating field of view. Near and far shell radii remain on opposite
sides of focus. The camera zoom has a smooth floor, so physical contraction
continues faster than camera motion near the endpoint. Optical settings
stay within the manual controls' ranges. Particle density is chosen only
at the black restart; it is not continually changed during visible flow.

Depth comes from parallax, focused luminous points, foreground/background
bokeh, and motion aligned with the actual projected fluid velocity. The
motion exposure uses an anisotropic Gaussian whose longitudinal variance
adds L²/12 for projected travel L. Dividing by both Gaussian widths preserves
integrated particle light. The straight-motion approximation is bounded to
2% of remaining physical time, with a 36-pixel travel cap. It neither emits
extra light when velocity rises nor draws artificial radial bursts.

Exposure is choreographed only during the introduction. **Click to look
around** captures the mouse and composes a relative look rotation with the
generated camera. WASD translates, R/F moves up/down, Q/E rolls, and Z/X
changes radar range without changing the camera or movement scale; generated motion, optics, and
physical time continue. Additional keys adjust ISO (−/+), field of view ([/]), shell depth (1/2),
focus (3/4), and bokeh (5/6). Every new clip clears the user position,
scale, rotation, and optical offsets, restoring its generated starting view. **Press Space to take
control** switches to manual flight at the current view and pauses the field.
Space then toggles play/pause. **Controls** or an input edit also hands over.
Escape releases mouse capture and resumes procedural viewing in one press
(or recenters an already-running movie). **Replay sequence** starts a
fresh procedural sequence. Reduced-motion users, `?intro=0`, and explicit
isolated field URLs start in manual mode.

Clicking to look switches from the explanatory arrival screen to a game HUD.
Only the HUD remains, with gauges for keyboard-controlled settings: radar
range/thickness, focus, bokeh, ISO/EV, field of view, position, attitude, travel
rate/boost, playback, and time. Each control has a short explanation except
WASD. Settings without keyboard mappings are omitted from these gauges. Key hints are not shown before that click. Manual mode
shows “Esc — return to auto.”

**Hide controls** removes all cockpit overlays, leaving a persistent
**Show controls** button. Hiding/restoring neither stops the camera nor
restarts the clock. Hidden controls are removed from keyboard navigation;
the restore affordance remains usable on narrow screens. **Screensaver**
uses fullscreen and hides all text, HUD, and controls; Escape restores the
interface while playback continues. Browsers without fullscreen support
use the same text-free presentation in the viewport.

## What the measurements mean

The core-width measure is sqrt((1−t)/(1−t_min)), the relative radial similarity
scale in the central plane. Axis speed is ((1−t_min)/(1−t))^(.5+h), the exact
relative velocity at the preserved core's origin. It is not the maximum
velocity anywhere in the surrounding field. These measures remain relative
to the dataset start, even when a later shot begins at higher magnification.

Captions describe contraction, axial stretching, and acceleration. The
scientific scope remains visible: this is the repository's finite forced
continuation, and the computed interval stops before t=1. The cinematic
presentation does not complete or validate the source's remaining matching
and correction construction.

## Hidden replenishment

Visible dust still follows the computed velocity. To keep the local sampling
pool useful, ordinary replacement proposals now sample the optical support
surfaces by area and weight them by inward flux relative to the translating
and scaling observer. The radius changes with the observation scale. A
12-candidate reservoir approximates this boundary distribution; it is not
a proof of exact uniform tracer density.

Births lie strictly on the invisible side of the shell. Existing incoming
dust uses the continuous spatial fade; applying another age fade would
artificially dim fast crossings. Explicit resets and initial populations
retain their temporal fade. Outgoing invisible guard particles are retired,
and failed incoming proposals leave an inactive slot to retry. Stationary
dust already in view keeps its position.

## Checks

- Seeded sampler checks cover many generated clips: reproducibility,
  varied angles/durations/optics, finite normalized camera poses, shell
  ordering, focus framing, linear time, and black restart boundaries.
- A real-time browser check observes a complete generated approach and
  its successor with white rendering, finite particles, and no WebGL errors.
- An injected endpoint GPU stall checks that the final image remains frozen
  throughout its fade and reaches black before the next dust population.
  Frame deltas and the GPU completion barrier use the same wall clock, so
  a queued animation timestamp cannot count the endpoint stall again.
- On macOS, the two mouse-capture integration checks use an asynchronous
  pointer-lock event fixture. Chromium's automation rejects native capture
  even on a minimal page ([upstream issue](https://github.com/microsoft/playwright/issues/20956)).
  The real application input handlers, GPU renderer, clocks, and resets still
  run; native permission and native Escape consumption remain unverified on
  this runner. Other platforms use the native API. Screensaver fullscreen
  and Escape use the native browser APIs here.
- Interaction checks cover keyboard handoff, controls, replay, reduced
  motion, and hiding/restoring the interface without stopping playback.
- GPU integration of circular and directional Gaussian footprints checks
  integrated particle light within 2% in the finite pixel fixture.
- The 5/6 keyboard gesture adjusts both ordinary defocus and boundary bokeh;
  both have HUD gauges. A GPU pixel-readback check holds each key, measures
  wider off-focus footprints (including the fading outer shell), and verifies
  that in-focus points stay sharp and integrated light stays within 2%.
  Movie offsets discard overshoot at their limits so reversing a key responds
  immediately; each new clip restores its own starting optics.
- Existing numerical-field, stationary-dust, inflow, recycling, and
  perspective checks cover the underlying simulation and rendering.

The image below is an earlier representative white-light composition;
procedural arrivals now generate different camera paths.

![White light and directional exposure near the core](../intro-preview.png)
