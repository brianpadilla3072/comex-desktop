(() => {
  const base = {{start}};
  const total = {{duration}};
  const selector = "#{{id}}";
  const state = "{{state}}"; // walk | arrive | idle
  const walkIn = Math.min(total, Math.max(0, Number({{walkIn}})));

  // Se animan los envoltorios: GSAP pisa el `transform` de los grupos con
  // translate propio y la figura salta al origen.
  const legs = [
    `${selector} #stand-leg-l-move`,
    `${selector} #stand-leg-r-move`,
  ];
  const arms = [
    `${selector} #stand-arm-l-move`,
    `${selector} #stand-arm-r-move`,
  ];
  const bags = [
    `${selector} #stand-bag-l-move`,
    `${selector} #stand-bag-r-move`,
  ];

  // Cuánto camina: `walk` todo el bloque; `arrive` solo la entrada.
  const walkTime = state === "idle" ? 0 : state === "arrive" ? walkIn : total;
  const STEP = 0.46; // medio ciclo de zancada
  const steps = Math.max(1, Math.round(walkTime / STEP / 2)) * 2; // par: termina donde empezó

  if (walkTime > 0.3) {
    // Piernas alternadas, con el pivote en la cadera.
    tl.to(legs[0], {
      rotation: 17,
      transformOrigin: "50% 0%",
      duration: STEP / 2,
      ease: "sine.inOut",
      repeat: steps,
      yoyo: true,
    }, base);
    tl.to(legs[1], {
      rotation: -17,
      transformOrigin: "50% 0%",
      duration: STEP / 2,
      ease: "sine.inOut",
      repeat: steps,
      yoyo: true,
    }, base + STEP / 2);

    // Brazos y bolsas acompañan el paso.
    arms.forEach((arm, i) => {
      tl.to(arm, {
        rotation: i === 0 ? -9 : 9,
        transformOrigin: "50% 4%",
        duration: STEP / 2,
        ease: "sine.inOut",
        repeat: steps,
        yoyo: true,
      }, base + (i ? STEP / 2 : 0));
    });
    bags.forEach((bag, i) => {
      tl.to(bag, {
        rotation: i === 0 ? 11 : -11,
        transformOrigin: "50% 0%",
        duration: STEP / 2,
        ease: "sine.inOut",
        repeat: steps,
        yoyo: true,
      }, base + (i ? STEP / 2 : 0));
    });

    // Rebote del cuerpo: dos veces por zancada.
    tl.to(`${selector} #stand-move`, {
      y: -9,
      duration: STEP / 2,
      ease: "sine.inOut",
      repeat: steps,
      yoyo: true,
    }, base);
  }

  // Llegada: las piernas frenan y las bolsas se acomodan.
  if (state === "arrive") {
    const settle = base + walkIn;
    tl.to(legs, { rotation: 0, duration: 0.18, ease: "power2.out" }, settle);
    tl.to(bags, { rotation: 0, duration: 0.34, ease: "back.out(2)" }, settle + 0.05);
    tl.to(`${selector} #stand-move`, { y: -12, duration: 0.16, ease: "power2.out" }, settle);
    tl.to(`${selector} #stand-move`, { y: 0, duration: 0.26, ease: "power2.in" }, settle + 0.16);
  }

  // Respiración desde que se detiene (o todo el bloque si está quieto).
  const restStart = state === "walk" ? base + walkTime : base + (state === "arrive" ? walkIn : 0);
  const rest = Math.max(0, total - (restStart - base));
  if (rest > 0.6) {
    const breaths = Math.max(1, Math.round(rest / 2.6));
    tl.to(`${selector} #stand-body-move`, {
      y: 4,
      duration: 1.3,
      ease: "sine.inOut",
      repeat: breaths,
      yoyo: true,
    }, restStart);
    tl.to(bags, {
      rotation: 3,
      transformOrigin: "50% 0%",
      duration: 1.3,
      ease: "sine.inOut",
      repeat: breaths,
      yoyo: true,
    }, restStart + 0.2);
  }
})();
