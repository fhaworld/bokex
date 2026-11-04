import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { Plugin } from "vite";
import { audioTypes, readMusicLibrary } from "../src/lib/music";

// Vite's public-file lookup leaves reserved characters such as %23 encoded.
// Handle music before that lookup, with the same static URLs used on Pages.
export function musicDevFiles(): Plugin {
  return {
    name: "moonlit-music-dev-files",
    apply: "serve",
    configureServer(server) {
      const base = server.config.base;
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? "/", "http://localhost")
          .pathname;
        if (
          !pathname.startsWith(`${base}music/`) ||
          !["GET", "HEAD"].includes(request.method ?? "")
        )
          return next();
        try {
          const library = await readMusicLibrary(base);
          const track = library.tracks.find((item) => item.url === pathname);
          if (!track) return next();
          const file = resolve(process.cwd(), "public/music", track.id);
          const info = await stat(file);
          let start = 0;
          let end = info.size - 1;
          const range = request.headers.range;
          const invalidRange = () => {
            response.writeHead(416, {
              "Content-Range": `bytes */${info.size}`,
            });
            response.end();
          };
          if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!match || (!match[1] && !match[2])) return invalidRange();
            if (match[1]) {
              start = Number(match[1]);
              if (match[2]) end = Math.min(end, Number(match[2]));
            } else {
              const suffix = Number(match[2]);
              if (!Number.isSafeInteger(suffix) || suffix <= 0)
                return invalidRange();
              start = Math.max(0, info.size - suffix);
            }
            if (
              !Number.isSafeInteger(start) ||
              !Number.isSafeInteger(end) ||
              start > end ||
              start >= info.size
            )
              return invalidRange();
            response.setHeader(
              "Content-Range",
              `bytes ${start}-${end}/${info.size}`,
            );
          }
          response.writeHead(range ? 206 : 200, {
            "Content-Type": audioTypes[extname(file).toLowerCase()],
            "Accept-Ranges": "bytes",
            "Content-Length": String(Math.max(0, end - start + 1)),
            "Cache-Control": "no-cache",
          });
          if (request.method === "HEAD" || info.size === 0)
            return response.end();
          const stream = createReadStream(file, { start, end });
          response.on("close", () => stream.destroy());
          stream.on("error", (error) => response.destroy(error));
          stream.pipe(response);
        } catch (error) {
          next(error);
        }
      });
    },
  };
}
