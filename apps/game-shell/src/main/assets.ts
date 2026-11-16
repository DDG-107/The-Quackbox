import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

export interface AssetServer {
  url: string;
  close(): Promise<void>;
}

/**
 * The platform hub is on the LAN; the game window must not share its origin.
 * This tiny server binds to loopback on a random port and exposes only the
 * game directory and the built SDK.
 */
export async function startAssetServer(options: {
  gamesRoot: string;
  sdkDir: string;
}): Promise<AssetServer> {
  const gamesRoot = resolve(options.gamesRoot);
  const sdkRoot = resolve(options.sdkDir);

  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      let root: string;
      let relative: string;

      if (url.pathname === "/sdk" || url.pathname.startsWith("/sdk/")) {
        root = sdkRoot;
        relative = url.pathname.slice("/sdk/".length);
      } else if (url.pathname.startsWith("/games/")) {
        root = gamesRoot;
        relative = url.pathname.slice("/games/".length);
      } else {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      const file = resolve(root, decodeURIComponent(relative));
      if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }
      if (!existsSync(file) || !statSync(file).isFile()) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }

      response.setHeader("Content-Type", CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      createReadStream(file)
        .on("error", () => {
          if (!response.headersSent) response.writeHead(500);
          response.end();
        })
        .pipe(response);
    } catch {
      response.writeHead(500);
      response.end("Asset server error");
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolveClose) => server.close(() => resolveClose())),
  };
}
