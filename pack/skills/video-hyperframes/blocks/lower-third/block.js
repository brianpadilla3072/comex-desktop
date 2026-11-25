tl.fromTo("#{{id}} .blk-lt", { x: -40, opacity: 0 },
  { x: 0, opacity: 1, duration: 0.38, ease: "power3.out" }, {{start}} + 0.15);
tl.fromTo("#{{id}} .blk-lt__bar", { scaleY: 0 },
  { scaleY: 1, duration: 0.42, ease: "power2.out" }, {{start}} + 0.28);
