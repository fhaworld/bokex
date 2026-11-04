import { readdir } from "node:fs/promises";
import { extname, resolve } from "node:path";

export interface MusicTrack {
  id: string;
  title: string;
  url: string;
}

export interface MusicLibrary {
  tracks: MusicTrack[];
  backgroundId: string | null;
}

export const audioTypes: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".opus": "audio/ogg",
  ".webm": "audio/webm",
};
const extensions = Object.keys(audioTypes);

async function scanMusic(
  directory: string,
  base: string,
  prefix = "",
): Promise<MusicTrack[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const groups = await Promise.all(
    entries.map(async (entry) => {
      const id = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        return scanMusic(resolve(directory, entry.name), base, `${id}/`);
      }
      const extension = extname(entry.name);
      if (!entry.isFile() || !extensions.includes(extension.toLowerCase()))
        return [];
      return [
        {
          id,
          title: id.slice(0, -extension.length),
          url: `${base}music/${id.split("/").map(encodeURIComponent).join("/")}`,
        },
      ];
    }),
  );
  return groups.flat();
}

export async function readMusicLibrary(base: string): Promise<MusicLibrary> {
  const tracks = await scanMusic(resolve(process.cwd(), "public/music"), base);
  tracks.sort((a, b) => a.id.localeCompare(b.id, "zh-CN", { numeric: true }));
  const background =
    extensions
      .map((extension) =>
        tracks.find(
          (track) => track.id.toLowerCase() === `background${extension}`,
        ),
      )
      .find(Boolean) ?? tracks[0];
  return { tracks, backgroundId: background?.id ?? null };
}
