// Unified tracking endpoint — handles both open (pixel) and click (redirect)
// Routes: /api/track/open?t=... and /api/track/click?t=...&url=...
// Merges former track/open.js + track/click.js into a single serverless function

const { redis, redisPipeline } = require("../_lib/redis");

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

module.exports = async function handler(req, res) {
  const action = req.query?.action;

  if (action === "open") {
    return handleOpen(req, res);
  } else if (action === "click") {
    return handleClick(req, res);
  }

  // Unknown action — return 404
  return res.status(404).json({ error: "Not found" });
};

// ---------------------------------------------------------------------------
// Open tracking (pixel)
// ---------------------------------------------------------------------------

async function handleOpen(req, res) {
  // Always return the pixel, regardless of errors
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");

  const trackingId = req.query?.t;
  if (!trackingId) {
    return res.status(200).end(PIXEL);
  }

  try {
    const raw = await redis(["HGETALL", `outreach:${trackingId}`]);
    if (!raw || raw.length === 0) {
      return res.status(200).end(PIXEL);
    }

    const outreach = {};
    for (let i = 0; i < raw.length; i += 2) {
      outreach[raw[i]] = raw[i + 1];
    }

    // Only record first open
    if (outreach.opened === "0") {
      const now = new Date().toISOString();
      const ts = Date.now();
      const contactId = outreach.contactId;

      const pipeline = [
        ["HSET", `outreach:${trackingId}`, "opened", "1", "openedAt", now],
        ["INCR", "stats:opens"],
      ];

      if (contactId) {
        pipeline.push([
          "ZADD", `contact:${contactId}:events`, ts.toString(),
          JSON.stringify({
            type: "email_opened",
            timestamp: now,
            data: { trackingId, subject: outreach.subject || "" },
          }),
        ]);
        // Upgrade status if currently "contacted"
        const contactRaw = await redis(["HGET", `contact:${contactId}`, "status"]);
        if (contactRaw === "contacted") {
          pipeline.push(
            ["HSET", `contact:${contactId}`, "status", "opened", "updatedAt", now],
            ["SREM", "contacts:status:contacted", contactId],
            ["SADD", "contacts:status:opened", contactId],
            ["ZADD", "contacts:index", ts.toString(), contactId]
          );
        }
      }

      await redisPipeline(pipeline);
    }
  } catch (err) {
    console.error("Track open error:", err.message);
    // Don't fail — still return the pixel
  }

  return res.status(200).end(PIXEL);
}

// ---------------------------------------------------------------------------
// Click tracking (redirect)
// ---------------------------------------------------------------------------

async function handleClick(req, res) {
  const trackingId = req.query?.t;
  const url = req.query?.url;

  // Always redirect, even on error
  const fallback = "https://entityping.com";
  const target = url && url.startsWith("https://") ? url : fallback;

  if (!trackingId) {
    return res.redirect(302, target);
  }

  try {
    const raw = await redis(["HGETALL", `outreach:${trackingId}`]);
    if (raw && raw.length > 0) {
      const outreach = {};
      for (let i = 0; i < raw.length; i += 2) {
        outreach[raw[i]] = raw[i + 1];
      }

      const now = new Date().toISOString();
      const ts = Date.now();
      const contactId = outreach.contactId;

      const pipeline = [
        ["HSET", `outreach:${trackingId}`, "clicked", "1", "clickedAt", now],
        ["INCR", "stats:clicks"],
      ];

      if (contactId) {
        pipeline.push([
          "ZADD", `contact:${contactId}:events`, ts.toString(),
          JSON.stringify({
            type: "link_clicked",
            timestamp: now,
            data: { trackingId, url: target, subject: outreach.subject || "" },
          }),
        ]);
        // Upgrade status if contacted or opened
        const contactStatus = await redis(["HGET", `contact:${contactId}`, "status"]);
        if (contactStatus === "contacted" || contactStatus === "opened") {
          pipeline.push(
            ["HSET", `contact:${contactId}`, "status", "clicked", "updatedAt", now],
            ["SREM", `contacts:status:${contactStatus}`, contactId],
            ["SADD", "contacts:status:clicked", contactId],
            ["ZADD", "contacts:index", ts.toString(), contactId]
          );
        }
      }

      await redisPipeline(pipeline);
    }
  } catch (err) {
    console.error("Track click error:", err.message);
  }

  return res.redirect(302, target);
}
