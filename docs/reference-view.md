# Fixed reference viewing

Choose **Reference view** in the main tools, or **Use this view as reference** in the observation controls. The viewer keeps the current camera position and orientation, observation scale, radar shell, focus, field of view, bokeh, ISO, rendering resolution, particle density and color settings. The field advances in linear simulation time with synchronized dust. Nothing about the velocity field changes.

For a chosen viewpoint, first explore manually and adjust the settings, then lock that view. While steering on desktop, press **V** to lock or unlock without releasing the mouse. On a phone, open **Settings** to find the reference button. The HUD continues to display simulation time and radar distance. Camera gestures, flight keys and the locked settings cannot change the view until **Unlock reference view** is selected. Unlocking pauses playback so the view can be adjusted deliberately.

Time speed, play/pause and the simulation-time slider remain available. Scrubbing pauses and reseeds particles, as in manual viewing. The reference does not automatically loop or reframe: it pauses at the finite dataset endpoint. **Replay sequence**, **Auto** or Escape returns to ordinary procedural viewing. Default arrival clips are unchanged.

This mode separates the flow's visible contraction and acceleration from cinematic changes in framing and exposure. It does not remove the artistic tracer emission, spherical visibility shell, bokeh or motion exposure. Tracers leaving the local observation buffer still recycle, and the display's brightness capacity remains finite. Mobile GPU backpressure can slow wall-clock playback; displayed simulation time remains the reference clock.

Reference settings apply to the current page session. They are not saved across field-selector reloads. For numerical comparisons between datasets, use the offline field and matching diagnostics in addition to images; an attractive rendering is not evidence of matching accuracy or smooth forcing.
