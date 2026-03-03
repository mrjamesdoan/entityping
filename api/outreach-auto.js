// Vercel Serverless Function — GET /api/outreach-auto
// Called by Vercel Cron at 15:00 UTC (8 AM PT), after the scraper runs.
// Sends vertical-specific cold outreach to freshly scraped contacts.

const crypto = require("crypto");
const { redis, redisPipeline } = require("./lib/redis");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = "EntityPing <hello@entityping.com>";
const BASE_URL = "https://entityping.com";
const DAILY_CAP = 40; // Max emails per cron run for deliverability

// Skip obviously bad emails
const EMAIL_BLACKLIST = [
  "noreply", "no-reply", "donotreply", "mailer-daemon", "postmaster",
  "phishing", "abuse", "spam", "sentry", "wixpress", "example.com",
];

function isJunkEmail(email) {
  const lower = (email || "").toLowerCase();
  return EMAIL_BLACKLIST.some((term) => lower.includes(term));
}

// ---------------------------------------------------------------------------
// Email helpers (same pattern as nurture.js)
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

function emailWrapper(bodyHtml, trackingId) {
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

// ---------------------------------------------------------------------------
// Parse contact metadata
// ---------------------------------------------------------------------------

function parseLocation(notes) {
  const match = (notes || "").match(/Location:\s*([^|]+)/);
  return match ? match[1].trim() : "";
}

function parseVertical(contact) {
  // Prefer dedicated field, fall back to notes parsing
  if (contact.vertical) return contact.vertical;
  const match = (contact.notes || "").match(/Vertical:\s*([^|]+)/);
  return match ? match[1].trim() : "";
}

// ---------------------------------------------------------------------------
// Cold outreach templates — one per industry vertical
// ---------------------------------------------------------------------------

function getTemplate(industry, vertical, businessName, location) {
  const city = location.split(",")[0].trim() || "your area";
  const ind = (industry || "").toLowerCase();

  if (ind.includes("insurance")) {
    return {
      subject: `New businesses opening in ${city} need insurance`,
      body: `
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi there,</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Every week, dozens of new LLCs and corporations register in ${city} &mdash; and every one of them needs general liability, business owner's policies, and workers' comp from day one.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">We built <strong>EntityPing</strong> to give insurance agents like you a head start. We monitor state filings and industry directories daily and deliver fresh business leads &mdash; with owner names, addresses, phone numbers, and industry classification &mdash; straight to your inbox every morning as a clean CSV.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">The best part? You reach them <strong>before your competition even knows they exist</strong>.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Plans start at <strong>$0.40 per lead</strong>. One closed policy pays for an entire year.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">Want to see real data? We'll send you a free sample of 25 Grade-A leads &mdash; no credit card, no commitment.</p>

        <a href="https://entityping.com/#free-sample" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">Get Your Free Sample</a>

        <p style="font-size: 14px; line-height: 1.6; margin: 16px 0 0; color: #64748b;">Or reply to this email &mdash; I read every response.</p>`,
    };
  }

  if (ind.includes("supplier") || ind.includes("distributor")) {
    return {
      subject: `New businesses opening near ${city} need suppliers`,
      body: `
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi there,</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">New businesses in ${city} are opening every week &mdash; tile shops, auto body shops, restaurants, retail stores &mdash; and every one of them needs vendors and suppliers before they lock in long-term contracts.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;"><strong>EntityPing</strong> monitors industry directories and state business filings daily, then delivers fresh leads to your inbox every morning. Each lead includes the business name, owner, address, phone number, and industry &mdash; so you know exactly who to call and what they need.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Reach them in their first week of operation, before your competitors get on the phone.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">See it for yourself &mdash; we'll send you 25 real leads for free:</p>

        <a href="https://entityping.com/#free-sample" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">Get Your Free Sample</a>

        <p style="font-size: 14px; line-height: 1.6; margin: 16px 0 0; color: #64748b;">Or reply to this email &mdash; I read every response.</p>`,
    };
  }

  if (ind.includes("marketing")) {
    return {
      subject: `New businesses in ${city} are spending on marketing`,
      body: `
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi there,</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Every new business that registers needs one thing fast: customers. That means marketing budgets get allocated in the first weeks of operation &mdash; and if you're not in front of them, someone else is.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;"><strong>EntityPing</strong> delivers fresh business leads daily &mdash; sourced from state filings and industry directories across ${city} and beyond. Owner names, addresses, phone numbers, and industry classification, all in a clean CSV you can import into any CRM or outreach tool.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Build hyper-targeted prospect lists for your clients at a fraction of the cost of traditional data providers. Plans start at <strong>$0.33 per lead</strong>.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">See real data &mdash; we'll send you a free sample of 25 Grade-A leads:</p>

        <a href="https://entityping.com/#free-sample" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">Get Your Free Sample</a>

        <p style="font-size: 14px; line-height: 1.6; margin: 16px 0 0; color: #64748b;">Or reply to this email &mdash; I read every response.</p>`,
    };
  }

  // Default: B2B Sales
  return {
    subject: `Fresh business leads in ${city}`,
    body: `
      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi there,</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">New businesses register every day in ${city} &mdash; and in their first weeks of operation, they're actively looking for service providers. Payment processing, IT support, bookkeeping, commercial cleaning &mdash; the buying window is wide open.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;"><strong>EntityPing</strong> monitors state filings and industry directories, then delivers fresh leads to your inbox every morning as a clean CSV. Each lead includes the business name, owner name, address, phone number, and industry &mdash; ready to load into your CRM and start calling.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">At <strong>$0.33 per lead</strong> on our Growth plan, one closed deal pays for an entire year of EntityPing.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">Want to see the data quality? We'll send you 25 leads for free:</p>

      <a href="https://entityping.com/#free-sample" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">Get Your Free Sample</a>

      <p style="font-size: 14px; line-height: 1.6; margin: 16px 0 0; color: #64748b;">Or reply to this email &mdash; I read every response.</p>`,
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Optional: verify Vercel Cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers["authorization"] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. Get all contacts with status "new"
    const newIds = await redis(["SMEMBERS", "contacts:status:new"]);

    if (!newIds || newIds.length === 0) {
      return res.status(200).json({ processed: 0, sent: 0, message: "No new contacts" });
    }

    // 2. Fetch all contacts in one pipeline
    const pipeline = newIds.map((id) => ["HGETALL", `contact:${id}`]);
    const rawResults = await redisPipeline(pipeline);

    const contacts = rawResults
      .map((r) => {
        if (!r.result || r.result.length === 0) return null;
        const obj = {};
        for (let i = 0; i < r.result.length; i += 2) {
          obj[r.result[i]] = r.result[i + 1];
        }
        return obj;
      })
      .filter(Boolean);

    // 3. Filter to scraper-sourced contacts only, skip junk emails
    const scraperContacts = contacts.filter(
      (c) => c.source === "scraper" && c.status === "new" && c.email && !isJunkEmail(c.email)
    );

    let totalSent = 0;
    const results = [];

    for (let i = 0; i < scraperContacts.length; i++) {
      const contact = scraperContacts[i];
      if (totalSent >= DAILY_CAP) break;

      // Throttle: 1 email per second to respect Resend's 2 req/s limit
      if (i > 0) await new Promise((r) => setTimeout(r, 1000));

      // 4. Idempotency check
      const sentFlag = `outreach-auto:sent:${contact.id}`;
      const alreadySent = await redis(["GET", sentFlag]);
      if (alreadySent) continue;

      // 5. Build email from vertical template
      const vertical = parseVertical(contact);
      const location = parseLocation(contact.notes);
      const template = getTemplate(contact.industry, vertical, contact.company, location);

      try {
        const trackingId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const fullHtml = emailWrapper(template.body, trackingId);

        const emailData = await sendEmail(contact.email, template.subject, fullHtml);

        const ts = Date.now();
        const timestamp = new Date().toISOString();

        // 6. Record everything in Redis
        await redisPipeline([
          // Idempotency flag
          ["SET", sentFlag, "1"],
          // Outreach record
          [
            "HSET", `outreach:${trackingId}`,
            "trackingId", trackingId,
            "contactId", contact.id,
            "email", contact.email,
            "subject", template.subject,
            "sentAt", timestamp,
            "opened", "0",
            "openedAt", "",
            "clicked", "0",
            "clickedAt", "",
            "resendId", emailData.id || "",
            "type", "cold_outreach",
            "industry", contact.industry || "",
            "vertical", vertical,
          ],
          ["ZADD", "outreach:index", ts.toString(), trackingId],
          // Contact event timeline
          [
            "ZADD", `contact:${contact.id}:events`, ts.toString(),
            JSON.stringify({
              type: "cold_outreach_sent",
              timestamp,
              data: {
                trackingId,
                subject: template.subject,
                industry: contact.industry,
                resendId: emailData.id || "",
              },
            }),
          ],
          // Update contact status: new → contacted
          ["HSET", `contact:${contact.id}`, "status", "contacted", "updatedAt", timestamp],
          ["ZADD", "contacts:index", ts.toString(), contact.id],
          ["SREM", "contacts:status:new", contact.id],
          ["SADD", "contacts:status:contacted", contact.id],
          // Stats
          ["INCR", "stats:outreach_sent"],
          ["INCR", "stats:outreach_auto_sent"],
        ]);

        totalSent++;
        results.push({
          contactId: contact.id,
          email: contact.email,
          industry: contact.industry,
          trackingId,
        });

        console.log(`Auto-outreach sent to ${contact.email} [${contact.industry}] (${contact.id})`);
      } catch (emailErr) {
        console.error(`Failed to send to ${contact.email}:`, emailErr.message);
        results.push({
          contactId: contact.id,
          email: contact.email,
          error: emailErr.message,
        });
      }
    }

    return res.status(200).json({
      processed: scraperContacts.length,
      sent: totalSent,
      cap: DAILY_CAP,
      results,
    });
  } catch (err) {
    console.error("Auto-outreach cron error:", err.message);
    return res.status(500).json({ error: "Auto-outreach failed", details: err.message });
  }
};
