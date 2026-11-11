import { useEffect, useRef } from "react";
import type { CompanionPreferences, CompanionSnapshot } from "@/app/lib/desktop-companion";

/** Original character. Canvas 2D, capped DPR/FPS; no 3D engine or copied Coucou artwork. */
export function Mascot({ state, preferences, size = 64 }: { state: CompanionSnapshot["state"]; preferences: CompanionPreferences; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, timer: ReturnType<typeof setTimeout> | undefined, visible = true, blink = false, last = 0, pokeUntil = 0, pokeCount = 0, lastPoke = 0;
    let image: HTMLImageElement | null = null;
    const draw = (now: number) => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      if (canvas.width !== size * dpr) { canvas.width = size * dpr; canvas.height = size * dpr; }
      ctx.setTransform(canvas.width / 100, 0, 0, canvas.height / 100, 0, 0); ctx.clearRect(0, 0, 100, 100);
      const moving = preferences.motion && !reduced.matches && state === "working";
      ctx.save(); ctx.translate(50, 54); ctx.rotate(moving ? Math.sin(now / 330) * .035 : 0); ctx.translate(-50, -54);
      if (image) { const scale = Math.min(80 / image.width, 80 / image.height); ctx.drawImage(image, 50 - image.width * scale / 2, 50 - image.height * scale / 2, image.width * scale, image.height * scale); ctx.restore(); return; }
      const warm = preferences.mascot === "ember";
      const body = ctx.createRadialGradient(36, 32, 3, 56, 60, 47);
      body.addColorStop(0, warm ? "#f6c285" : "#d3dfba"); body.addColorStop(.6, warm ? "#cf8c59" : "#91b48c"); body.addColorStop(1, warm ? "#9b613f" : "#587d64");
      ctx.fillStyle = body; ctx.beginPath(); ctx.moveTo(50, 21); ctx.bezierCurveTo(69, 18, 79, 36, 78, 55); ctx.bezierCurveTo(78, 76, 67, 83, 49, 83); ctx.bezierCurveTo(29, 84, 20, 73, 22, 54); ctx.bezierCurveTo(23, 36, 32, 24, 50, 21); ctx.fill();
      ctx.fillStyle = warm ? "#b86c42" : "#547d59"; ctx.beginPath(); ctx.ellipse(55, 17, 12, 6, -.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#335342"; ctx.beginPath(); ctx.ellipse(36, 83, 7, 3, 0, 0, Math.PI * 2); ctx.ellipse(65, 83, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#243b32"; ctx.fillStyle = "#243b32"; ctx.lineCap = "round"; ctx.lineWidth = 2.5;
      for (const x of [39, 59]) { ctx.beginPath(); if (blink || state === "offline" || pokeUntil > now) { ctx.moveTo(x - 3, 49); ctx.lineTo(x + 3, 50); ctx.stroke(); } else { ctx.ellipse(x, 49, 2.7, state === "waiting" ? 5 : 3.7, 0, 0, Math.PI * 2); ctx.fill(); } }
      ctx.beginPath(); ctx.lineWidth = 1.8;
      if (state === "waiting" || state === "error") ctx.ellipse(49, 62, 2.5, 3, 0, 0, Math.PI * 2);
      else { ctx.moveTo(45, 61); ctx.quadraticCurveTo(49, 66, 54, 61); } ctx.stroke(); ctx.restore();
    };
    const animate = (now: number) => { frame = 0; if (document.hidden || !visible) return;
      if (now - last > 1000 / 24) { draw(now); last = now; }
      if (preferences.motion && !reduced.matches && state === "working") frame = requestAnimationFrame(animate);
    };
    const wake = () => { if (frame) cancelAnimationFrame(frame); frame = 0; draw(performance.now()); if (visible && !document.hidden && preferences.motion && !reduced.matches && state === "working") frame = requestAnimationFrame(animate); };
    const blinkLater = () => { clearTimeout(timer); if (!visible || document.hidden || !preferences.motion || reduced.matches) return;
      timer = setTimeout(() => { blink = true; draw(performance.now()); timer = setTimeout(() => { blink = false; wake(); blinkLater(); }, 130); }, 4200);
    };
    if (preferences.mascot === "image" && preferences.image) { image = new Image(); image.onload = wake; image.src = preferences.image; }
    const poke = () => { const now = performance.now(); pokeCount = now - lastPoke < 1600 ? pokeCount + 1 : 1; lastPoke = now; pokeUntil = now + (pokeCount >= 3 ? 1500 : 500); draw(now); clearTimeout(timer); timer = setTimeout(() => { wake(); blinkLater(); }, pokeCount >= 3 ? 1500 : 500); };
    const visibility = () => { wake(); blinkLater(); };
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; visibility(); }); observer.observe(canvas);
    canvas.addEventListener("pointerdown", poke); document.addEventListener("visibilitychange", visibility); reduced.addEventListener("change", visibility);
    wake(); blinkLater();
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); observer.disconnect(); canvas.removeEventListener("pointerdown", poke); document.removeEventListener("visibilitychange", visibility); reduced.removeEventListener("change", visibility); if (image) image.onload = null; };
  }, [preferences.mascot, preferences.image, preferences.motion, size, state]);
  return <canvas ref={ref} style={{ width: size, height: size }} role="img" aria-label="Mascota del asistente" />;
}
