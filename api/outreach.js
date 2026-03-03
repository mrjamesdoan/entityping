const crypto = require("crypto");
const { redis, redisPipeline, isAuthed, unauthorized } = require("./lib/redis");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = "EntityPing <hello@entityping.com>";
const BASE_URL = "https://entityping.com";

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  if (!isAuthed(req)) return unauthorized(res);

  if (req.method === "GET") return handleList(req, res);
  if (req.method === "POST") return handleSend(req, res);
  return res.status(405).json({ error: "Method not allowed" });
};

async function handleList(req, res) {
  try {
    const ids = await redis(["ZREVRANGE", "outreach:index", "0", "99"]);
    if (!ids || ids.length === 0) return res.status(200).json([]);

    const pipeline = ids.map((id) => ["HGETALL", `outreach:${id}`]);
    const results = await redisPipeline(pipeline);

    const outreaches = results.map((r) => {
      if (!r.result || r.result.length === 0) return null;
      const obj = {};
      for (let i = 0; i < r.result.length; i += 2) {
        obj[r.result[i]] = r.result[i + 1];
      }
      return obj;
    }).filter(Boolean);

    return res.status(200).json(outreaches);
  } catch (err) {
    console.error("Outreach list error:", err.message);
    return res.status(500).json({ error: "Failed to list outreach" });
  }
}

async function handleSend(req, res) {
  try {
    const { contactId, subject, htmlBody } = req.body || {};

    if (!contactId || !subject || !htmlBody) {
      return res.status(400).json({ error: "contactId, subject, and htmlBody are required" });
    }

    // Look up contact
    const raw = await redis(["HGETALL", `contact:${contactId}`]);
    if (!raw || raw.length === 0) {
      return res.status(404).json({ error: "Contact not found" });
    }
    const contact = {};
    for (let i = 0; i < raw.length; i += 2) {
      contact[raw[i]] = raw[i + 1];
    }

    // Generate tracking ID
    const trackingId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    // Inject tracking pixel and wrap links
    let trackedHtml = wrapLinks(htmlBody, trackingId);
    trackedHtml = addTrackingPixel(trackedHtml, trackingId);

    // Send via Resend
    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: contact.email,
        subject: subject,
        html: trackedHtml,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      console.error("Resend error:", errText);
      return res.status(500).json({ error: "Failed to send email" });
    }

    const emailData = await emailRes.json();
    const now = new Date().toISOString();
    const ts = Date.now();

    // Record in Redis
    await redisPipeline([
      [
        "HSET", `outreach:${trackingId}`,
        "trackingId", trackingId,
        "contactId", contactId,
        "email", contact.email,
        "subject", subject,
        "sentAt", now,
        "opened", "0",
        "openedAt", "",
        "clicked", "0",
        "clickedAt", "",
        "resendId", emailData.id || "",
        "htmlBody", htmlBody,
      ],
      ["ZADD", "outreach:index", ts.toString(), trackingId],
      [
        "ZADD", `contact:${contactId}:events`, ts.toString(),
        JSON.stringify({
          type: "email_sent",
          timestamp: now,
          data: { trackingId, subject, resendId: emailData.id || "" },
        }),
      ],
      ["HSET", `contact:${contactId}`, "status", "contacted", "updatedAt", now],
      ["SREM", "contacts:status:new", contactId],
      ["SADD", "contacts:status:contacted", contactId],
      ["ZADD", "contacts:index", ts.toString(), contactId],
      ["INCR", "stats:outreach_sent"],
    ]);

    return res.status(200).json({ success: true, trackingId });
  } catch (err) {
    console.error("Outreach send error:", err.message);
    return res.status(500).json({ error: "Failed to send outreach" });
  }
}

function wrapLinks(html, trackingId) {
  return html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (match, url) => {
      const tracked = `${BASE_URL}/api/track/click?t=${trackingId}&url=${encodeURIComponent(url)}`;
      return `href="${tracked}"`;
    }
  );
}

function addTrackingPixel(html, trackingId) {
  const pixel = `<img src="${BASE_URL}/api/track/open?t=${trackingId}" width="1" height="1" style="display:none" alt="" />`;
  if (html.includes("</body>")) {
    return html.replace("</body>", pixel + "</body>");
  }
  return html + pixel;
}
