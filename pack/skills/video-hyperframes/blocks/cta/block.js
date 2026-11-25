tl.fromTo("#{{id}} .blk-cta__chip", { y: 16, opacity: 0 },
  { y: 0, opacity: 1, duration: 0.3, ease: "power3.out" }, {{start}} + 0.1);
tl.fromTo("#{{id}} .blk-cta__text", { y: 24, opacity: 0 },
  { y: 0, opacity: 1, duration: 0.35, ease: "power4.out" }, {{start}} + 0.24);
tl.fromTo("#{{id}} .blk-cta__sub", { y: 18, opacity: 0 },
  { y: 0, opacity: 1, duration: 0.35, ease: "power3.out" }, {{start}} + 0.46);
