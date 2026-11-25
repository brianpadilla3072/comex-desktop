tl.fromTo("#{{id}} .blk-quote", { opacity: 0, y: 44 },
  { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" }, {{start}} + 0.08);
tl.fromTo("#{{id}} .blk-quote__mark", { opacity: 0, scale: 0.7 },
  { opacity: 0.2, scale: 1, duration: 0.6, ease: "back.out(2)" }, {{start}} + 0.2);
tl.fromTo("#{{id}} .blk-quote__text", { opacity: 0, y: 24 },
  { opacity: 1, y: 0, duration: 0.45, ease: "power3.out" }, {{start}} + 0.26);
tl.fromTo("#{{id}} .blk-quote__bar", { scaleY: 0 },
  { scaleY: 1, duration: 0.35, ease: "power3.out" }, {{start}} + 0.52);
tl.fromTo("#{{id}} .blk-quote__name", { opacity: 0, x: -16 },
  { opacity: 1, x: 0, duration: 0.4, ease: "power3.out" }, {{start}} + 0.58);
tl.fromTo("#{{id}} .blk-quote__role", { opacity: 0, y: 10 },
  { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" }, {{start}} + 0.68);
