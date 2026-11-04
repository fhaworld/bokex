let disposeClock: (() => void) | undefined;

function setupMoonClock() {
  disposeClock?.();
  const clock = document.querySelector<HTMLElement>("[data-moon-clock]");
  if (!clock) return;
  const hourHand = clock.querySelector<SVGGElement>("[data-clock-hour]")!;
  const minuteHand = clock.querySelector<SVGGElement>("[data-clock-minute]")!;
  const secondHand = clock.querySelector<SVGGElement>("[data-clock-second]")!;
  const dial = clock.querySelector<HTMLElement>("[data-clock-dial]")!;
  const time = clock.querySelector<HTMLTimeElement>("[data-clock-time]")!;
  const dateLabel = clock.querySelector<HTMLElement>("[data-clock-date]")!;
  const uptime = clock.querySelector<HTMLElement>("[data-site-uptime]");
  const startedAt = Date.parse(uptime?.dataset.start ?? "2025-12-15T13:31:00+08:00");
  const uptimeParts = ["days", "hours", "minutes", "seconds"].map((part) =>
    clock.querySelector<HTMLElement>(`[data-uptime-${part}]`),
  );
  const events = new AbortController();
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const dateFormat = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  let frame = 0;
  let timer = 0;
  let visible = false;
  let lastFrame = 0;
  let lastSecond = -1;
  const smooth = () =>
    !reduce.matches && document.documentElement.dataset.motion !== "off";

  function paint() {
    const now = new Date();
    const fraction = smooth() ? now.getMilliseconds() / 1000 : 0;
    const seconds = now.getSeconds() + fraction;
    const minutes = now.getMinutes() + seconds / 60;
    const hours = (now.getHours() % 12) + minutes / 60;
    hourHand.setAttribute("transform", `rotate(${hours * 30} 100 100)`);
    minuteHand.setAttribute("transform", `rotate(${minutes * 6} 100 100)`);
    secondHand.setAttribute("transform", `rotate(${seconds * 6} 100 100)`);
    clock.dataset.clockReady = "true";
    const second = Math.floor(now.valueOf() / 1000);
    if (second !== lastSecond) {
      const text = [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map((part) => String(part).padStart(2, "0"))
        .join(":");
      time.textContent = text;
      time.dateTime = now.toISOString();
      dateLabel.textContent = dateFormat.format(now);
      dial.setAttribute(
        "aria-label",
        `本地时间 ${dateLabel.textContent} ${text}`,
      );
      const elapsed = Math.max(0, Math.floor((now.valueOf() - startedAt) / 1000));
      const values = [
        Math.floor(elapsed / 86400),
        Math.floor(elapsed / 3600) % 24,
        Math.floor(elapsed / 60) % 60,
        elapsed % 60,
      ];
      uptimeParts.forEach((part, index) => {
        if (part) part.textContent = index === 0 ? String(values[index]) : String(values[index]).padStart(2, "0");
      });
      lastSecond = second;
    }
  }
  function stop() {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = timer = 0;
  }
  function tick(timestamp: number) {
    frame = 0;
    if (!visible || document.hidden) return;
    if (timestamp - lastFrame >= 1000 / 30) {
      paint();
      lastFrame = timestamp;
    }
    frame = requestAnimationFrame(tick);
  }
  function discreteTick() {
    if (!visible || document.hidden) return;
    paint();
    timer = window.setTimeout(discreteTick, 1000 - (Date.now() % 1000) + 5);
  }
  function sync() {
    stop();
    if (!visible || document.hidden) return;
    paint();
    if (smooth()) frame = requestAnimationFrame(tick);
    else
      timer = window.setTimeout(discreteTick, 1000 - (Date.now() % 1000) + 5);
  }
  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    sync();
  });
  intersection.observe(clock);
  const motion = new MutationObserver(sync);
  motion.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-motion"],
  });
  reduce.addEventListener("change", sync, { signal: events.signal });
  document.addEventListener("visibilitychange", sync, {
    signal: events.signal,
  });
  clock.querySelector<HTMLImageElement>("[data-clock-art]")?.addEventListener(
    "error",
    (event) => {
      (event.currentTarget as HTMLImageElement).hidden = true;
    },
    { signal: events.signal },
  );
  paint();
  disposeClock = () => {
    stop();
    intersection.disconnect();
    motion.disconnect();
    events.abort();
  };
}

document.addEventListener("astro:page-load", setupMoonClock);
document.addEventListener("astro:before-swap", () => disposeClock?.());
