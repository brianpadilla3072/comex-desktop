(() => {
  const base = {{start}};
  const total = {{duration}};
  const selector = "#{{id}}";

  const fromHour = {{fromHour}};
  const toHour = {{toHour}};
  const fromPct = {{percentFrom}};
  const toPct = {{percentTo}};

  const clockEl = document.querySelector(`${selector} .blk-hud__clock`);
  const fillEl = document.querySelector(`${selector} .blk-hud__fill`);
  const pctEl = document.querySelector(`${selector} .blk-hud__pct`);

  const pad = (n) => String(n).padStart(2, "0");

  const paint = (progress) => {
    const hours = fromHour + (toHour - fromHour) * progress;
    const hh = Math.floor(hours);
    const mm = Math.min(59, Math.round((hours - hh) * 60));
    if (clockEl) clockEl.textContent = `+${pad(hh)}:${pad(mm)}`;

    const pct = fromPct + (toPct - fromPct) * progress;
    if (fillEl) fillEl.style.transform = `scaleX(${Math.max(0, Math.min(1, pct / 100))})`;
    if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
  };

  paint(0);
  const state = { t: 0 };
  tl.to(state, {
    t: 1,
    duration: total,
    ease: "none",
    onUpdate: () => paint(state.t),
  }, base);
})();
