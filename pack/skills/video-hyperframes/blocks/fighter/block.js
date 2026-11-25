(() => {
  const POSES = {
    idle: { armL: 8, armR: -8, head: 0, crouch: 0 },
    power: { armL: 52, armR: -52, head: -2, crouch: 8 },
    punch: { armL: 44, armR: -98, head: -4, crouch: 2 },
    guard: { armL: 86, armR: -86, head: 0, crouch: 4 },
    fly: { armL: 152, armR: -152, head: 6, crouch: -10 },
  };

  const MOUTHS = { smile: ".m-smile", open: ".m-open", wow: ".m-wow" };

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
    tl.set(`${selector} #body`, { y: pose.crouch }, at);

    if (rawMood) {
      const mood = rawMood.trim();
      for (const [key, sel] of Object.entries(MOUTHS)) {
        tl.set(`${selector} ${sel}`, { opacity: key === mood ? 1 : 0 }, at);
      }
    }
  }

  // Aura: pulso finito, determinista.
  if ("{{aura}}" !== "off") {
    const pulses = Math.max(2, Math.round(total / 0.9));
    tl.fromTo(`${selector} .aura-ring`,
      { scale: 0.9, opacity: 0.35, transformOrigin: "50% 50%" },
      { scale: 1.12, opacity: 0.62, duration: 0.55, ease: "sine.inOut", repeat: pulses, yoyo: true }, base);
    tl.fromTo(`${selector} .aura-core`,
      { scale: 0.94, opacity: 0.5, transformOrigin: "50% 50%" },
      { scale: 1.08, opacity: 0.85, duration: 0.4, ease: "sine.inOut", repeat: pulses, yoyo: true }, base + 0.2);
  }

  const breaths = Math.max(1, Math.round(total / 2.4));
  tl.to(`${selector} #char-move`, {
    y: -8, duration: 1.2, ease: "sine.inOut", repeat: breaths, yoyo: true,
  }, base);

  const blinkEvery = 2.4;
  for (let t = 1; t < total - 0.2; t += blinkEvery) {
    tl.set(`${selector} #eyes`, { scaleY: 0.12, transformOrigin: "50% 50%" }, base + t);
    tl.set(`${selector} #eyes`, { scaleY: 1 }, base + t + 0.08);
  }
})();
