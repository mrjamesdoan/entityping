const { redis, redisPipeline } = require("../lib/redis");

module.exports = async function handler(req, res) {
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
};
