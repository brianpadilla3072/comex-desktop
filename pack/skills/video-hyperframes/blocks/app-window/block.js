tl.fromTo("#{{id}} .blk-win", { y: 60, opacity: 0, scale: 0.97 },
  { y: 0, opacity: 1, scale: 1, duration: 0.5, ease: "power3.out" }, {{start}} + 0.1);
tl.fromTo("#{{id}} .blk-win__row", { x: 30, opacity: 0 },
  { x: 0, opacity: 1, duration: 0.3, ease: "power3.out", stagger: 0.14 }, {{start}} + 0.34);
