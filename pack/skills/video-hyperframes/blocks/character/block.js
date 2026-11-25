(() => {
  const POSES = {
    idle: { armL: 6, armR: -6, head: 0 },
    talk: { armL: 30, armR: -26, head: 2 },
    point: { armL: 10, armR: -104, head: -3 },
    cheer: { armL: 132, armR: -132, head: -4 },
    shrug: { armL: 46, armR: -46, head: -5 },
  };

  const MOUTHS = {
    closed: ".m-closed",
    half: ".m-half",
    open: ".m-open",
    wide: ".m-wide",
  };

  // alias viejos, para no romper beats existentes
  const MOOD_ALIAS = { smile: "closed", wow: "wide" };

  const base = {{start}};
  const total = {{duration}};
  const selector = "#{{id}}";

  const seq = "{{poses}}"
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!seq.length) seq.push("idle:0");

  for (const item of seq) {
    const [rawName, rawAt, rawMood] = item.split(":");
    const name = (rawName || "idle").trim();
    const pose = POSES[name] || POSES.idle;
    const at = base + Number(rawAt || 0);

    tl.set(`${selector} #arm-l`, { rotation: pose.armL, transformOrigin: "50% 2%" }, at);
    tl.set(`${selector} #arm-r`, { rotation: pose.armR, transformOrigin: "50% 2%" }, at);
    tl.set(`${selector} #head`, { rotation: pose.head, transformOrigin: "50% 100%" }, at);

    if (rawMood) {
      const key = MOOD_ALIAS[rawMood.trim()] || rawMood.trim();
      for (const [shape, sel] of Object.entries(MOUTHS)) {
        tl.set(`${selector} ${sel}`, { opacity: shape === key ? 1 : 0 }, at);
      }
    }
  }

  // ------------------------------------------------------------ lipsync ----
  // MOUTH es una lista de formas por cuadro (0 cerrada, 1 media, 2 abierta,
  // 3 ancha). Si viene vacía, se usa la boca de la pose.
  const RAW = {{mouth}};
  const MOUTH = Array.isArray(RAW) ? RAW : RAW && Array.isArray(RAW.frames) ? RAW.frames : [];
  if (MOUTH.length) {
    const MFPS = (RAW && RAW.fps) || {{mouthFps}};
    const els = Object.values(MOUTHS).map((sel) => document.querySelector(`${selector} ${sel}`));
    const dur = MOUTH.length / MFPS;
    const state = { t: 0 };

    tl.to(state, {
      t: dur,
      duration: dur,
      ease: "none",
      onUpdate: () => {
        const i = Math.min(MOUTH.length - 1, Math.max(0, Math.floor(state.t * MFPS)));
        const shape = MOUTH[i];
        for (let k = 0; k < els.length; k++) {
          if (els[k]) els[k].style.opacity = k === shape ? "1" : "0";
        }
      },
    }, base + {{mouthStart}});
  }

  // Respiración y parpadeo: bucles finitos, así el seek sigue siendo determinista.
  const breaths = Math.max(1, Math.round(total / 2.4));
  tl.to(`${selector} #char-move`, {
    y: -9,
    duration: 1.2,
    ease: "sine.inOut",
    repeat: breaths,
    yoyo: true,
  }, base);

  // Parpadeo por pares de set: un tween con repeat impar dejaba los ojos cerrados.
  const blinkEvery = 2.2;
  for (let t = 1; t < total - 0.2; t += blinkEvery) {
    tl.set(`${selector} #eyes`, { scaleY: 0.12, transformOrigin: "50% 50%" }, base + t);
    tl.set(`${selector} #eyes`, { scaleY: 1 }, base + t + 0.09);
  }
})();
