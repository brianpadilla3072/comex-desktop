tl.fromTo("#{{id}} .blk-bars", { y: 40, opacity: 0 },
  { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, {{start}} + 0.12);
tl.fromTo("#{{id}} .blk-bars__fill", { scaleX: 0 },
  { scaleX: 1, duration: 0.7, ease: "power2.out", stagger: 0.12 }, {{start}} + 0.35);
tl.fromTo("#{{id}} .blk-bars__value", { opacity: 0 },
  { opacity: 1, duration: 0.35, stagger: 0.12 }, {{start}} + 0.55);
