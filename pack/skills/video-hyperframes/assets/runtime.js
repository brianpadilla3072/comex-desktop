/**
 * Runtime HyperFrames para video-hyperframes (AsyncStudio).
 *
 * Implementa el mismo contrato que HyperFrames: la composición registra una
 * línea de tiempo GSAP pausada en `window.__timelines[id]` y este runtime la
 * lleva a un tiempo exacto. Se inyecta antes de cargar el documento, así que
 * lee `window.__timelines` en el momento del seek, no al definirse.
 *
 * No usa red, timers ni aleatoriedad: el cuadro es función del tiempo.
 */
(() => {
  if (window.__hf) return;

  // El contrato asume que el runtime provee el registro de líneas.
  window.__timelines = window.__timelines || {};

  const root = () => document.querySelector("[data-composition-id]");

  const totalDuration = () => {
    const el = root();
    const d = el && el.dataset.duration ? parseFloat(el.dataset.duration) : 0;
    return Number.isFinite(d) ? d : 0;
  };

  // Un .clip se ve en [data-start, data-start + data-duration).
  // Se oculta con visibility en el propio clip; las animaciones van en un hijo.
  const applyClips = (t) => {
    const total = totalDuration();
    for (const el of document.querySelectorAll(".clip")) {
      const start = el.dataset.start === undefined ? 0 : parseFloat(el.dataset.start);
      const dur =
        el.dataset.duration === undefined ? total - start : parseFloat(el.dataset.duration);
      const visible = t >= start - 1e-4 && t < start + dur - 1e-4;
      el.style.visibility = visible ? "" : "hidden";
    }
  };

  const seek = (t) => {
    const timelines = window.__timelines || {};
    for (const key of Object.keys(timelines)) {
      const tl = timelines[key];
      if (!tl || typeof tl.seek !== "function") continue;
      try {
        if (typeof tl.pause === "function") tl.pause();
        tl.seek(t, false);
      } catch (err) {
        console.warn("[hf] timeline", key, err && err.message);
      }
    }

    // Animaciones CSS: mismo instante, sin reloj propio.
    if (document.getAnimations) {
      for (const anim of document.getAnimations()) {
        try {
          anim.pause();
          anim.currentTime = t * 1000;
        } catch (_) {
          /* animaciones no controlables */
        }
      }
    }

    applyClips(t);
    return t;
  };

  window.__hf = {
    get duration() {
      return totalDuration();
    },
    seek,
    ready: true,
  };
})();
