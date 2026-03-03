// Vercel Serverless Function — GET /api/nurture
// Called daily by Vercel Cron at 10:00 UTC (6 AM ET)
// Sends 3-email post-sample nurture sequence at Day 2, Day 4, and Day 7

const crypto = require("crypto");
const { redis, redisPipeline } = require("./_lib/redis");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = "EntityPing <hello@entityping.com>";
const BASE_URL = "https://entityping.com";

const NURTURE_SCHEDULE = [
  { day: 2, key: "day2" },
  { day: 4, key: "day4" },
  { day: 7, key: "day7" },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Email helpers
// ---------------------------------------------------------------------------

async function sendEmail(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${res.status} ${err}`);
  }

  return res.json();
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
  return html + pixel;
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function emailWrapper(firstName, bodyHtml, trackingId) {
  const tracked = wrapLinks(bodyHtml, trackingId);
  const withPixel = addTrackingPixel(tracked, trackingId);

  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
    <div style="padding: 32px 0; border-bottom: 1px solid #e2e8f0;">
      <span style="font-size: 20px; font-weight: 700; color: #0f172a;">Entity<span style="color: #1486f5;">Ping</span></span>
    </div>

    <div style="padding: 32px 0;">
      ${withPixel}
    </div>

    <div style="padding: 24px 0; border-top: 1px solid #e2e8f0;">
      <p style="font-size: 13px; color: #94a3b8; margin: 0;">EntityPing &mdash; Targeted business leads, delivered daily.<br>
      <a href="https://entityping.com" style="color: #1486f5; text-decoration: none;">entityping.com</a></p>
    </div>
  </div>`;
}

function day2Email(firstName) {
  return `
      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${firstName},</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Just checking in &mdash; did you get a chance to open the sample CSV we sent over?</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Those 25 leads were pulled from <strong>just one day</strong> of Florida business filings. Every single day, hundreds of new businesses register &mdash; and each one is a potential customer looking for services exactly like yours.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">If you haven't had a chance yet, pop it open in Excel or Google Sheets. You'll see complete owner names, addresses, industry tags, and quality scores &mdash; all ready to work.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">When you're ready for a daily feed of leads like these, we've got you covered:</p>

      <a href="https://entityping.com/#pricing" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">See Plans &amp; Pricing</a>`;
}

function day4Email(firstName) {
  return `
      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${firstName},</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">While you've been thinking it over, <strong>847 new businesses registered</strong> in Florida alone. That's 847 new potential customers &mdash; and your competitors may already be reaching out to them.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Here's the math: on our Growth plan, you get up to <strong>3,000 leads per month</strong> for $99. That works out to about <strong>$0.033 per lead</strong> &mdash; less than the cost of a single Google click. And these aren't cold prospects; they're brand-new businesses actively setting up operations and looking for vendors.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Every day without EntityPing is a day of fresh leads going straight to your competition.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">The sooner you start, the sooner you close:</p>

      <a href="https://entityping.com/#pricing" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">Start Getting Leads Today</a>`;
}

function day7Email(firstName) {
  return `
      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${firstName},</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">I wanted to reach out one more time &mdash; are you still interested in getting fresh business leads delivered to your inbox?</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">If you have any questions about how EntityPing works, how the data is sourced, or which plan makes sense for your business &mdash; I'm happy to hop on a quick call and walk you through it. No pressure at all.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">You can also just <strong>reply to this email</strong> and it'll come straight to me. I read every response personally.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">Either way, the sample we sent is yours to keep. If the timing isn't right now, we'll be here when it is.</p>

      <a href="https://entityping.com/#pricing" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">View Plans &amp; Pricing</a>`;
}

function getSubject(dayKey, firstName) {
  switch (dayKey) {
    case "day2":
      return `Did you open your leads yet, ${firstName}?`;
    case "day4":
      return "While you were thinking about it, 847 new businesses registered";
    case "day7":
      return "Still interested in fresh business leads?";
    default:
      return "A note from EntityPing";
  }
}

function getBody(dayKey, firstName) {
  switch (dayKey) {
    case "day2":
      return day2Email(firstName);
    case "day4":
      return day4Email(firstName);
    case "day7":
      return day7Email(firstName);
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  // Vercel Cron sends GET requests
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Optional: verify Vercel Cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers["authorization"] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. Get all contact IDs from the index (scan all, filter in code)
    const allIds = await redis(["ZRANGE", "contacts:index", "0", "-1"]);

    if (!allIds || allIds.length === 0) {
      return res.status(200).json({ processed: 0, sent: 0, message: "No contacts found" });
    }

    const now = Date.now();
    let totalSent = 0;
    let totalProcessed = 0;
    const results = [];

    // 2. Process each contact
    for (const contactId of allIds) {
      // Fetch contact data
      const raw = await redis(["HGETALL", `contact:${contactId}`]);
      if (!raw || raw.length === 0) continue;

      const contact = {};
      for (let i = 0; i < raw.length; i += 2) {
        contact[raw[i]] = raw[i + 1];
      }

      // Only nurture form_submission contacts with "new" status
      if (contact.source !== "form_submission" || contact.status !== "new") {
        continue;
      }

      totalProcessed++;

      const createdAt = new Date(contact.createdAt).getTime();
      if (isNaN(createdAt)) continue;

      const daysSinceSignup = (now - createdAt) / MS_PER_DAY;
      const firstName = contact.name ? contact.name.split(" ")[0] : "there";

      // 3. Check each nurture step
      for (const step of NURTURE_SCHEDULE) {
        if (daysSinceSignup < step.day) continue;

        // Don't send nurture emails more than 3 days past their window
        if (daysSinceSignup > step.day + 3) continue;

        // Check if already sent
        const flagKey = `nurture:${contactId}:${step.key}`;
        const alreadySent = await redis(["GET", flagKey]);
        if (alreadySent) continue;

        // Build and send the email
        try {
          const trackingId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
          const subject = getSubject(step.key, firstName);
          const bodyHtml = getBody(step.key, firstName);
          const fullHtml = emailWrapper(firstName, bodyHtml, trackingId);

          const emailData = await sendEmail(contact.email, subject, fullHtml);

          const ts = Date.now();
          const timestamp = new Date().toISOString();

          // Record: nurture flag, outreach record, contact event, stats
          await redisPipeline([
            // Mark this nurture step as sent
            ["SET", flagKey, "1"],
            // Store outreach record (same pattern as outreach.js)
            [
              "HSET", `outreach:${trackingId}`,
              "trackingId", trackingId,
              "contactId", contactId,
              "email", contact.email,
              "subject", subject,
              "sentAt", timestamp,
              "opened", "0",
              "openedAt", "",
              "clicked", "0",
              "clickedAt", "",
              "resendId", emailData.id || "",
              "type", "nurture",
              "nurtureStep", step.key,
            ],
            ["ZADD", "outreach:index", ts.toString(), trackingId],
            // Log event on contact timeline
            [
              "ZADD", `contact:${contactId}:events`, ts.toString(),
              JSON.stringify({
                type: "nurture_email_sent",
                timestamp,
                data: {
                  trackingId,
                  subject,
                  nurtureStep: step.key,
                  resendId: emailData.id || "",
                },
              }),
            ],
            // Update contact timestamp
            ["HSET", `contact:${contactId}`, "updatedAt", timestamp],
            ["ZADD", "contacts:index", ts.toString(), contactId],
            // Stats
            ["INCR", "stats:nurture_sent"],
            ["INCR", `stats:nurture_${step.key}_sent`],
          ]);

          totalSent++;
          results.push({
            contactId,
            email: contact.email,
            step: step.key,
            trackingId,
          });

          console.log(`Nurture ${step.key} sent to ${contact.email} (contact ${contactId})`);
        } catch (emailErr) {
          console.error(`Failed to send nurture ${step.key} to ${contact.email}:`, emailErr.message);
          results.push({
            contactId,
            email: contact.email,
            step: step.key,
            error: emailErr.message,
          });
        }
      }
    }

    return res.status(200).json({
      processed: totalProcessed,
      sent: totalSent,
      results,
    });
  } catch (err) {
    console.error("Nurture cron error:", err.message);
    return res.status(500).json({ error: "Nurture sequence failed", details: err.message });
  }
};
