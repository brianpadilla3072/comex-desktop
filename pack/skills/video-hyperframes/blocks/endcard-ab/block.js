(() => {
  const base = {{start}};
  const selector = "#{{id}}";

  tl.fromTo(`${selector} .blk-ec__kicker`,
    { y: 14, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.28, ease: "power3.out" },
    base + 0.08);

  tl.fromTo(`${selector} .blk-ec__card--a`,
    { y: 40, scale: 0.86, opacity: 0 },
    { y: 0, scale: 1, opacity: 1, duration: 0.42, ease: "back.out(1.8)" },
    base + 0.18);

  tl.fromTo(`${selector} .blk-ec__card--b`,
    { y: 40, scale: 0.86, opacity: 0 },
    { y: 0, scale: 1, opacity: 1, duration: 0.42, ease: "back.out(1.8)" },
    base + 0.34);

  tl.fromTo(`${selector} .blk-ec__cta`,
    { y: 22, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.34, ease: "power4.out" },
    base + 0.62);

  // Latido del CTA: dos golpes cortos, después queda quieto.
  tl.to(`${selector} .blk-ec__cta`, {
    scale: 1.06,
    duration: 0.22,
    ease: "sine.inOut",
    repeat: 4,
    yoyo: true,
  }, base + 1.05);
})();
