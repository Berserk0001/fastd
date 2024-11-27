"use strict";

/*
 * proxy.js
 * The bandwidth hero proxy handler with integrated modules.
 */
import fetch from "node-fetch";
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

  input
    .pipe(
      sharpInstance
        .resize(null, 16383, {
          withoutEnlargement: true
        })
        .grayscale(req.params.grayscale)
        .toFormat(format, {
          quality: req.params.quality,
          chromaSubsampling: '4:4:4',
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
    req.headers["via"] === "1.1 bandwidth-hero" &&
    ["127.0.0.1", "::1"].includes(req.headers["x-forwarded-for"] || req.ip)
  ) {
    return redirect(req, res);
  }

  try {
    const origin = await fetch(req.params.url, {
      headers: {
        ...pick(req.headers, ["cookie", "dnt", "referer", "range"]),
        "user-agent": "Bandwidth-Hero Compressor",
        "x-forwarded-for": req.headers["x-forwarded-for"] || req.ip,
        via: "1.1 bandwidth-hero",
      },
      redirect: 'follow',
      follow: 4,
    });

    // Handle non-2xx or redirect responses.
    if (
      origin.status >= 400 ||
      (origin.status >= 300 && origin.headers.get('location'))
    ) {
      return redirect(req, res);
    }

    // Set headers and stream response.
    copyHeaders(origin.headers, res);
    res.setHeader("content-encoding", "identity");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "unsafe-none");
    req.params.originType = origin.headers.get("content-type") || "";
    req.params.originSize = origin.headers.get("content-length") || "0";

    if (shouldCompress(req)) {
      return compress(req, res, origin.body);
    } else {
      res.setHeader("x-proxy-bypass", 1);
      ["accept-ranges", "content-type", "content-length", "content-range"].forEach((header) => {
        if (origin.headers.get(header)) {
          res.setHeader(header, origin.headers.get(header));
        }
      });
      return origin.body.pipe(res);
    }
  } catch (err) {
    if (err.type === "invalid-url") {
      return res.status(400).send("Invalid URL");
    }
    redirect(req, res);
    console.error(err);
  }
}

export default proxy;
