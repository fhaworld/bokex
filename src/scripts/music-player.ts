import type { MusicLibrary } from "../lib/music";

const root = document.querySelector<HTMLElement>("[data-site-music]")!;
const library: MusicLibrary = JSON.parse(root.dataset.library!);
const audio = root.querySelector<HTMLAudioElement>("[data-site-audio]")!;
const backgroundButton =
  root.querySelector<HTMLButtonElement>("[data-bgm-toggle]")!;
const backgroundLabel = root.querySelector<HTMLElement>("[data-bgm-label]")!;
const backgroundMessage =
  root.querySelector<HTMLElement>("[data-bgm-message]")!;
const miniPlayer = root.querySelector<HTMLElement>("[data-mini-player]")!;
const miniTitle = root.querySelector<HTMLElement>("[data-mini-title]")!;
const miniTime = root.querySelector<HTMLElement>("[data-mini-time]")!;
const miniPlay = root.querySelector<HTMLButtonElement>("[data-mini-play]")!;
function queryMusicPanel() {
  const panel = document.querySelector<HTMLElement>("[data-music-panel]");
  const playButton =
    panel?.querySelector<HTMLButtonElement>("[data-music-play]");
  const previousButton = panel?.querySelector<HTMLButtonElement>(
    "[data-music-previous]",
  );
  const nextButton =
    panel?.querySelector<HTMLButtonElement>("[data-music-next]");
  const seek = panel?.querySelector<HTMLInputElement>("[data-music-seek]");
  const volume = panel?.querySelector<HTMLInputElement>("[data-music-volume]");
  const volumeValue = panel?.querySelector<HTMLElement>("[data-volume-value]");
  const elapsed = panel?.querySelector<HTMLElement>("[data-music-elapsed]");
  const duration = panel?.querySelector<HTMLElement>("[data-music-duration]");
  const title = panel?.querySelector<HTMLElement>("[data-music-title]");
  const subtitle = panel?.querySelector<HTMLElement>("[data-music-subtitle]");
  const modeLabel = panel?.querySelector<HTMLElement>("[data-music-mode]");
  const message = panel?.querySelector<HTMLElement>("[data-music-message]");
  const list = panel?.querySelector<HTMLOListElement>("[data-music-list]");
  const count = panel?.querySelector<HTMLElement>("[data-music-count]");
  const playlistToggle = panel?.querySelector<HTMLButtonElement>(
    "[data-playlist-toggle]",
  );
  const playlistPopover = panel?.querySelector<HTMLElement>(
    "[data-playlist-popover]",
  );
  const playlistClose = panel?.querySelector<HTMLButtonElement>(
    "[data-playlist-close]",
  );
  return {
    panel,
    playButton,
    previousButton,
    nextButton,
    seek,
    volume,
    volumeValue,
    elapsed,
    duration,
    title,
    subtitle,
    modeLabel,
    message,
    list,
    count,
    playlistToggle,
    playlistPopover,
    playlistClose,
  };
}
let {
  panel,
  playButton,
  previousButton,
  nextButton,
  seek,
  volume,
  volumeValue,
  elapsed,
  duration,
  title,
  subtitle,
  modeLabel,
  message,
  list,
  count,
  playlistToggle,
  playlistPopover,
  playlistClose,
} = queryMusicPanel();
let panelEvents: AbortController | undefined;
let currentMessage = "";
const backgroundIndex = library.tracks.findIndex(
  (track) => track.id === library.backgroundId,
);
let currentIndex = library.tracks.length ? 0 : -1;
let mode: "playlist" | "background" = "playlist";
let playVersion = 0;
let pendingPlay = false;
let wantsPlayback = false;

function saveBackground(enabled: boolean) {
  try {
    localStorage.setItem("moon-background-music", String(enabled));
  } catch {}
}

function setMessage(text: string) {
  currentMessage = text;
  if (message) message.textContent = text;
  backgroundMessage.textContent = text;
  backgroundMessage.hidden = !text;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor(total / 60) % 60).padStart(2, "0");
  const remainder = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${minutes}:${remainder}` : `${minutes}:${remainder}`;
}

function renderTime() {
  miniTime.textContent = formatTime(audio.currentTime);
  const hasDuration = Number.isFinite(audio.duration) && audio.duration > 0;
  if (elapsed) elapsed.textContent = formatTime(audio.currentTime);
  if (duration) duration.textContent = formatTime(audio.duration);
  if (seek) {
    seek.disabled = !hasDuration;
    seek.max = hasDuration ? String(audio.duration) : "1";
    seek.value = hasDuration ? String(audio.currentTime) : "0";
    seek.setAttribute(
      "aria-valuetext",
      `${formatTime(audio.currentTime)} / ${formatTime(audio.duration)}`,
    );
  }
}

function renderState() {
  const track = library.tracks[currentIndex];
  const playing = !audio.paused && !audio.ended;
  const activeBackground = mode === "background" && playing;
  miniPlayer.hidden = Boolean(panel) || !track;
  miniTitle.textContent = track?.title ?? "";
  miniTitle.title = track?.title ?? "";
  miniPlay.setAttribute(
    "aria-label",
    playing || pendingPlay ? "暂停音乐" : "播放音乐",
  );
  miniPlay
    .querySelector("[data-mini-play-icon]")
    ?.toggleAttribute("hidden", playing || pendingPlay);
  miniPlay
    .querySelector("[data-mini-pause-icon]")
    ?.toggleAttribute("hidden", !playing && !pendingPlay);
  backgroundButton.disabled = backgroundIndex < 0;
  backgroundButton.setAttribute("aria-pressed", String(activeBackground));
  backgroundLabel.textContent =
    backgroundIndex < 0
      ? "待收录"
      : activeBackground
        ? "开"
        : pendingPlay && mode === "background"
          ? "加载中"
          : "关";
  backgroundButton.title =
    backgroundIndex < 0
      ? "背景音乐暂未收录"
      : activeBackground
        ? "关闭背景音乐"
        : "开启背景音乐";
  panel?.setAttribute("data-playing", String(playing));
  if (title) {
    title.textContent = track?.title ?? "暂未收录音乐";
    title.title = track?.title ?? "";
  }
  if (subtitle)
    subtitle.textContent = track
      ? `${currentIndex + 1} / ${library.tracks.length} · ${mode === "background" ? "背景循环" : "播放列表"}`
      : "等一段旋律，落在这个夜晚。";
  if (modeLabel)
    modeLabel.textContent = pendingPlay
      ? "LOADING"
      : playing
        ? "NOW PLAYING"
        : "MOONLIT SOUNDS";
  if (count) count.textContent = `${library.tracks.length} 首音乐`;
  if (playButton) {
    playButton.disabled = !track;
    playButton.setAttribute(
      "aria-label",
      playing || pendingPlay ? "暂停音乐" : "播放音乐",
    );
    playButton
      .querySelector<SVGElement>("[data-play-icon]")
      ?.toggleAttribute("hidden", playing || pendingPlay);
    playButton
      .querySelector<SVGElement>("[data-pause-icon]")
      ?.toggleAttribute("hidden", !playing && !pendingPlay);
  }
  if (previousButton) previousButton.disabled = library.tracks.length < 2;
  if (nextButton) nextButton.disabled = library.tracks.length < 2;
  list
    ?.querySelectorAll<HTMLButtonElement>("[data-track-index]")
    .forEach((button) => {
      const index = Number(button.dataset.trackIndex);
      const selected = index === currentIndex;
      button.setAttribute("aria-current", String(selected));
      const state = button.querySelector<HTMLElement>(".track-state")!;
      state.textContent =
        selected && playing
          ? mode === "background"
            ? "循环中"
            : "播放中"
          : library.tracks[index].id === library.backgroundId
            ? "背景曲"
            : "";
    });
  renderTime();
}

function pausePlayback() {
  playVersion++;
  pendingPlay = false;
  wantsPlayback = false;
  audio.pause();
  saveBackground(false);
  setMessage("");
  renderState();
}

async function playTrack(index: number, nextMode: typeof mode) {
  const track = library.tracks[index];
  if (!track) return;
  const version = ++playVersion;
  currentIndex = index;
  mode = nextMode;
  pendingPlay = true;
  wantsPlayback = true;
  saveBackground(mode === "background");
  if (audio.getAttribute("src") !== track.url || audio.error) {
    audio.pause();
    audio.src = track.url;
    audio.load();
  } else if (audio.ended) {
    audio.currentTime = 0;
  }
  audio.loop = mode === "background";
  setMessage("正在加载音乐…");
  renderState();
  try {
    await audio.play();
    if (version !== playVersion) return;
    pendingPlay = false;
    setMessage("");
    renderState();
  } catch (error) {
    if (version !== playVersion) return;
    pendingPlay = false;
    wantsPlayback = false;
    if ((error as DOMException).name === "NotAllowedError") {
      setMessage("请点击播放按钮，开始播放音乐。");
    } else {
      saveBackground(false);
      setMessage("这首音频无法播放，请检查文件或换一首。");
    }
    renderState();
  }
}

backgroundButton.addEventListener("click", () => {
  if (mode === "background" && (!audio.paused || pendingPlay)) pausePlayback();
  else void playTrack(backgroundIndex, "background");
});
miniPlay.addEventListener("click", () => {
  if (!audio.paused || pendingPlay) pausePlayback();
  else void playTrack(currentIndex, mode);
});
audio.addEventListener("play", () => {
  if (!wantsPlayback) audio.pause();
  renderState();
});
audio.addEventListener("pause", renderState);
audio.addEventListener("loadedmetadata", renderTime);
audio.addEventListener("durationchange", renderTime);
audio.addEventListener("timeupdate", renderTime);
audio.addEventListener("ended", () => {
  if (wantsPlayback && mode === "playlist") {
    void playTrack((currentIndex + 1) % library.tracks.length, "playlist");
  } else renderState();
});
audio.addEventListener("error", () => {
  if (!audio.error) return;
  playVersion++;
  pendingPlay = false;
  wantsPlayback = false;
  saveBackground(false);
  setMessage("这首音频无法播放，请检查文件或换一首。");
  renderState();
});

audio.volume = 0.25;
try {
  const savedVolume = localStorage.getItem("moon-music-volume");
  if (savedVolume !== null && Number.isFinite(Number(savedVolume))) {
    audio.volume = Math.min(1, Math.max(0, Number(savedVolume)));
  }
} catch {}
renderState();
try {
  if (
    backgroundIndex >= 0 &&
    localStorage.getItem("moon-background-music") === "true"
  ) {
    void playTrack(backgroundIndex, "background");
  }
} catch {}

function bindMusicPanel() {
  panelEvents?.abort();
  panelEvents = new AbortController();
  const { signal } = panelEvents;
  ({
    panel,
    playButton,
    previousButton,
    nextButton,
    seek,
    volume,
    volumeValue,
    elapsed,
    duration,
    title,
    subtitle,
    modeLabel,
    message,
    list,
    count,
    playlistToggle,
    playlistPopover,
    playlistClose,
  } = queryMusicPanel());

  const popup = playlistPopover;
  const popupToggle = playlistToggle;
  const popupClose = playlistClose;
  const nativePopover = Boolean(
    popup && typeof popup.showPopover === "function",
  );
  const playlistOpen = () =>
    Boolean(
      popup &&
      (nativePopover
        ? popup.matches(":popover-open")
        : popup.dataset.open === "true"),
    );
  function positionPlaylist() {
    if (!popup || !popupToggle || !playlistOpen()) return;
    const anchor = popupToggle.getBoundingClientRect();
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const left = Math.max(
      16,
      Math.min(anchor.right - width, viewportWidth - width - 16),
    );
    const below = viewportHeight - anchor.bottom - 16;
    const top =
      below >= height + 12
        ? anchor.bottom + 12
        : anchor.top >= height + 28
          ? anchor.top - height - 12
          : Math.max(
              16,
              Math.min(anchor.bottom + 12, viewportHeight - height - 16),
            );
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }
  function reflectPlaylist(focusTrack = false) {
    const open = playlistOpen();
    popupToggle?.setAttribute("aria-expanded", String(open));
    popupToggle?.setAttribute(
      "aria-label",
      open ? "收起播放列表" : "打开播放列表",
    );
    if (open) {
      positionPlaylist();
      if (focusTrack) {
        const selected =
          popup?.querySelector<HTMLButtonElement>(
            '[data-track-index][aria-current="true"]',
          ) ?? popup?.querySelector<HTMLButtonElement>("[data-track-index]");
        selected?.focus({ preventScroll: true });
        const scrollList = selected?.closest<HTMLOListElement>(".music-list");
        if (selected && scrollList) {
          const trackBounds = selected.getBoundingClientRect();
          const listBounds = scrollList.getBoundingClientRect();
          scrollList.scrollTop +=
            trackBounds.top -
            listBounds.top -
            (scrollList.clientHeight - trackBounds.height) / 2;
        }
      }
    }
  }
  function closePlaylist(returnFocus = true) {
    if (!popup || !playlistOpen()) return;
    if (nativePopover) popup.hidePopover();
    else delete popup.dataset.open;
    reflectPlaylist();
    if (returnFocus) popupToggle?.focus({ preventScroll: true });
  }
  if (popup && popupToggle) {
    if (nativePopover) {
      popup.addEventListener("toggle", () => reflectPlaylist(playlistOpen()), {
        signal,
      });
    } else {
      popup.removeAttribute("popover");
      popupToggle.removeAttribute("popovertarget");
      popupClose?.removeAttribute("popovertarget");
      popupToggle.addEventListener(
        "click",
        () => {
          if (playlistOpen()) closePlaylist();
          else {
            popup.dataset.open = "true";
            reflectPlaylist(true);
          }
        },
        { signal },
      );
      popupClose?.addEventListener("click", () => closePlaylist(), { signal });
      document.addEventListener(
        "pointerdown",
        (event) => {
          const target = event.target as Node;
          if (!popup.contains(target) && !popupToggle.contains(target))
            closePlaylist(false);
        },
        { signal },
      );
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape" && playlistOpen()) {
            event.preventDefault();
            closePlaylist();
          }
        },
        { signal },
      );
    }
    addEventListener("resize", positionPlaylist, { signal });
    document.addEventListener("scroll", positionPlaylist, {
      capture: true,
      passive: true,
      signal,
    });
  }
  playButton?.addEventListener(
    "click",
    () => {
      if (!audio.paused || pendingPlay) pausePlayback();
      else void playTrack(currentIndex, mode);
    },
    { signal },
  );
  previousButton?.addEventListener(
    "click",
    () => {
      void playTrack(
        (currentIndex - 1 + library.tracks.length) % library.tracks.length,
        "playlist",
      );
    },
    { signal },
  );
  nextButton?.addEventListener(
    "click",
    () => {
      void playTrack((currentIndex + 1) % library.tracks.length, "playlist");
    },
    { signal },
  );
  seek?.addEventListener(
    "input",
    (event) => {
      const input = event.currentTarget as HTMLInputElement;
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        audio.currentTime = Math.min(
          audio.duration,
          Math.max(0, Number(input.value)),
        );
        renderTime();
      }
    },
    { signal },
  );
  volume?.addEventListener(
    "input",
    (event) => {
      const input = event.currentTarget as HTMLInputElement;
      audio.volume = Number(input.value);
      if (volumeValue)
        volumeValue.textContent = `${Math.round(audio.volume * 100)}%`;
      try {
        localStorage.setItem("moon-music-volume", String(audio.volume));
      } catch {}
    },
    { signal },
  );

  const playlist = list;
  if (playlist && library.tracks.length) {
    playlist.replaceChildren();
    library.tracks.forEach((track, index) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "music-track";
      button.dataset.trackIndex = String(index);
      button.title = track.id;
      const number = document.createElement("span");
      number.className = "track-number";
      number.textContent = String(index + 1).padStart(2, "0");
      const name = document.createElement("span");
      name.className = "track-name";
      name.textContent = track.title;
      const state = document.createElement("span");
      state.className = "track-state";
      button.append(number, name, state);
      button.addEventListener(
        "click",
        () => {
          void playTrack(index, "playlist");
          closePlaylist();
        },
        { signal },
      );
      item.append(button);
      playlist.append(item);
    });
  }

  if (volume) {
    volume.value = String(audio.volume);
    volume.disabled = library.tracks.length === 0;
  }
  if (volumeValue)
    volumeValue.textContent = `${Math.round(audio.volume * 100)}%`;

  if (message) message.textContent = currentMessage;
  renderState();
}

document.addEventListener("astro:page-load", bindMusicPanel);
document.addEventListener("astro:before-swap", () => {
  if (
    typeof playlistPopover?.hidePopover === "function" &&
    playlistPopover.matches(":popover-open")
  )
    playlistPopover.hidePopover();
  panelEvents?.abort();
});
