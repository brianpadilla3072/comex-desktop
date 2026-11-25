(() => {
  const base = {{start}};
  const total = {{duration}};
  const selector = "#{{id}}";
  const state = "{{state}}";

  const arms = document.querySelectorAll(`${selector} #seated-arm-l, ${selector} #seated-arm-r`);
  const head = document.querySelector(`${selector} #seated-head-move`);
  const torso = document.querySelector(`${selector} #seated-torso`);

  if (state === "sleep") {
    // Cabeza apoyada en el escritorio: baja y se ladea.
    tl.set(head, { y: 96, rotation: -18, transformOrigin: "50% 100%" }, base);
    tl.set(torso, { y: 18 }, base);
    tl.to(`${selector} #seated-move`, {
      y: 6,
      duration: 2.2,
      ease: "sine.inOut",
      repeat: Math.max(1, Math.round(total / 2.2)),
      yoyo: true,
    }, base);
  } else if (state === "idle") {
    tl.set(head, { rotation: 0, transformOrigin: "50% 100%" }, base);
    tl.to(`${selector} #seated-move`, {
      y: -6,
      duration: 1.8,
      ease: "sine.inOut",
      repeat: Math.max(1, Math.round(total / 1.8)),
      yoyo: true,
    }, base);
  } else {
    // typing: hombros y brazos con un movimiento corto y alternado.
    const cycles = Math.max(2, Math.round(total / 0.45));
    tl.to(arms[0], {
      rotation: -6,
      transformOrigin: "50% 4%",
      duration: 0.22,
      ease: "sine.inOut",
      repeat: cycles,
      yoyo: true,
    }, base);
    tl.to(arms[1], {
      rotation: 6,
      transformOrigin: "50% 4%",
      duration: 0.22,
      ease: "sine.inOut",
      repeat: cycles,
      yoyo: true,
    }, base + 0.11);
    tl.to(`${selector} #seated-move`, {
      y: -3,
      duration: 0.9,
      ease: "sine.inOut",
      repeat: Math.max(1, Math.round(total / 0.9)),
      yoyo: true,
    }, base);
  }
})();
