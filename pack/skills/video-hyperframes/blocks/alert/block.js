tl.fromTo("#{{id}} .blk-alert", { scale: 0.86, opacity: 0, y: 20 },
  { scale: 1, opacity: 1, y: 0, duration: 0.42, ease: "back.out(1.6)" }, {{start}} + 0.12);
tl.fromTo("#{{id}} .blk-alert", { boxShadow: "0 0 0px rgba(252,208,61,0)" },
  { boxShadow: "0 0 70px rgba(252,208,61,0.35)", duration: 0.6, yoyo: true, repeat: 1 }, {{start}} + 0.5);
