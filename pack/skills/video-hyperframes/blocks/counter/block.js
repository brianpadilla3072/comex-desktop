(() => {
  const el = document.querySelector("#{{id}} .blk-count__num");
  const state = { v: 0 };
  tl.fromTo("#{{id}} .blk-count", { opacity: 0, y: 30 },
    { opacity: 1, y: 0, duration: 0.35, ease: "power3.out" }, {{start}} + 0.1);
  tl.to(state, {
    v: {{value}}, duration: 1.3, ease: "power2.out",
    onUpdate: () => { el.textContent = Math.round(state.v).toLocaleString("es-AR"); }
  }, {{start}} + 0.2);
})();
