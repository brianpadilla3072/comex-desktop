(() => {
  const base = {{start}};
  const total = {{duration}};
  const selector = "#{{id}}";

  // El set entra con un push-in muy leve: da vida sin mover el encuadre.
  tl.fromTo(`${selector} .blk-room__svg`,
    { scale: 1.02 },
    { scale: 1, duration: Math.max(0.6, total), ease: "none" },
    base);

  // El monitor respira. Bucles finitos: el seek sigue siendo determinista.
  if ("{{monitor}}" !== "off") {
    const pulses = Math.max(1, Math.round(total / 1.6));
    tl.fromTo(`${selector} .blk-room__screen-ui`,
      { opacity: 0.72 },
      { opacity: 1, duration: 0.8, ease: "sine.inOut", repeat: pulses, yoyo: true },
      base);
  }
})();
