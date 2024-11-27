"use strict";

/*
 * proxy.js
 * The bandwidth hero proxy handler with integrated modules.
 */
import sharp from "sharp";
import { availableParallelism } from 'os';

import pick from "./pick.js";
const DEFAULT_QUALITY = 40;
const MIN_COMPRESS_LENGTH = 1024;
const MIN_TRANSPARENT_COMPRESS_LENGTH = MIN_COMPRESS_LENGTH * 100;

// Helper: Should compress
function shouldCompress(req) {
  const { originType, originSize, webp } = req.params;

  if (!originType.startsWith("image")) return false;
  if (originSize === 0) return false;
  if (req.headers.range) return false;
  if (webp && originSize < MIN_COMPRESS_LENGTH) return false;
  if (
    !webp &&
    (originType.endsWith("png") || originType.endsWith("gif")) &&
    originSize < MIN_TRANSPARENT_COMPRESS_LENGTH
  ) {
    return false;
  }

  return true;
}

// Helper: Copy headers
function copyHeaders(source, target) {
  for (const [key, value] of Object.entries(source.headers)) {
    try {
      target.setHeader(key, value);
    } catch (e) {
      console.log(e.message);
    }
  }
}

// Helper: Redirect
function redirect(req, res) {
  if (res.headersSent) return;

  res.setHeader("content-length", 0);
  res.removeHeader("cache-control");
  res.removeHeader("expires");
  res.removeHeader("date");
  res.removeHeader("etag");
  res.setHeader("location", encodeURI(req.params.url));
  res.status(302).end();
}

// Helper: Compress
function compress(req, res, input) {
  const format = "jpeg";

  sharp.cache(false);
  sharp.simd(true);
  sharp.concurrency(availableParallelism());

  const sharpInstance = sharp({
    unlimited: true,
    failOn: "none",
    limitInputPixels: false,
  });

  input.body
    .pipe(
      sharpInstance
        .resize(null, 16383, {
          withoutEnlargement: true
        })
        .grayscale(req.params.grayscale)
        .toFormat(format, {
          quality: req.params.quality,
          chromaSubsampling: '4:4:4', // Default chroma subsampling
          effort: 0,
        })
        .on("error", () => redirect(req, res))
        .on("info", (info) => {
          res.setHeader("content-type", "image/" + format);
          res.setHeader("content-length", info.size);
          res.setHeader("x-original-size", req.params.originSize);
          res.setHeader("x-bytes-saved", req.params.originSize - info.size);
          res.status(200);
        })
    )
    .pipe(res);
}

// Main: Proxy
async function proxy(req, res) {
  // Extract and validate parameters from the request
  let url = req.query.url;
  if (!url) return res.send("bandwidth-hero-proxy");

  req.params = {};
  req.params.url = decodeURIComponent(url);
  req.params.webp = !req.query.jpeg;
  req.params.grayscale = req.query.bw != 0;
  req.params.quality = parseInt(req.query.l, 10) || DEFAULT_QUALITY;

  // Avoid loopback that could cause server hang.
  if (
    req.headers["via"] == "1.1 bandwidth-hero" &&
    ["127.0.0.1", "::1"].includes(req.headers["x-forwarded-for"] || req.ip)
  )
    return redirect(req, res);
  try {
    let origin = await fetch(req.params.url, {
      method: req.method,
      headers: {
        ...pick(req.headers, ["cookie", "dnt", "referer", "range"]),
        "user-agent": "Bandwidth-Hero Compressor",
        "x-forwarded-for": req.headers["x-forwarded-for"] || req.ip,
        via: "1.1 bandwidth-hero",
      }
    });

    _onRequestResponse(origin, req, res);
  } catch (err) {
    _onRequestError(req, res, err);
  }
}

function _onRequestError(req, res, err) {
  // Ignore invalid URL.
  if (err.code === "ERR_INVALID_URL") return res.status(400).send("Invalid URL");

  /*
   * When there's a real error, Redirect then destroy the stream immediately.
   */
  redirect(req, res);
  console.error(err);
}

function _onRequestResponse(origin, req, res) {
  if (origin.status >= 400)
    return redirect(req, res);

  // handle redirects
  if (origin.status >= 300 && origin.headers.get("location"))
    return redirect(req, res);

  copyHeaders(origin, res);
  res.setHeader("content-encoding", "identity");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
  req.params.originType = origin.headers.get("content-type") || "";
  req.params.originSize = origin.headers.get("content-length") || "0";

  origin.body.on('error', _ => req.socket.destroy());

  if (shouldCompress(req)) {
    /*
     * sharp support stream. So pipe it.
     */
    return compress(req, res, origin);
  } else {
    /*
     * Downloading then uploading the buffer to the client is not a good idea though,
     * It would better if you pipe the incoming buffer to client directly.
     */

    res.setHeader("x-proxy-bypass", 1);

    for (const headerName of ["accept-ranges", "content-type", "content-length", "content-range"]) {
      if (origin.headers.has(headerName))
        res.setHeader(headerName, origin.headers.get(headerName));
    }

    return origin.body.pipe(res);
  }
}

export default proxy;
