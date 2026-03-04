// Unified outreach endpoint — manual sends, listing, and automated cold outreach
// GET  /api/outreach            → list outreach history (admin)
// POST /api/outreach            → send manual outreach (admin)
// GET  /api/outreach?auto=1     → automated cold outreach cron
// Merges former outreach.js + outreach-auto.js into a single serverless function

const crypto = require("crypto");
const { redis, redisPipeline, isAuthed, unauthorized } = require("./_lib/redis");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = "EntityPing <hello@entityping.com>";
const BASE_URL = "https://entityping.com";
const DAILY_CAP = 150; // Auto-scaled 2026-03-04 (pool: 907, incoming: 669)

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
// Main handler
// ---------------------------------------------------------------------------

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(200).end();
  }

  // Auto-outreach cron route (no admin auth — uses cron secret)
  if (req.method === "GET" && req.query?.auto === "1") {
    return handleAutoCron(req, res);
  }

  // All other routes require admin auth
  if (!isAuthed(req)) return unauthorized(res);

  if (req.method === "GET") return handleList(req, res);
  if (req.method === "POST") return handleSend(req, res);
  return res.status(405).json({ error: "Method not allowed" });
};

// ---------------------------------------------------------------------------
// List outreach history (admin)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Send manual outreach (admin)
// ---------------------------------------------------------------------------

async function handleSend(req, res) {
  try {
    const { contactId, subject, htmlBody } = req.body || {};

    if (!contactId || !subject || !htmlBody) {
      return res.status(400).json({ error: "contactId, subject, and htmlBody are required" });
    }

    const raw = await redis(["HGETALL", `contact:${contactId}`]);
    if (!raw || raw.length === 0) {
      return res.status(404).json({ error: "Contact not found" });
    }
    const contact = {};
    for (let i = 0; i < raw.length; i += 2) {
      contact[raw[i]] = raw[i + 1];
    }

    const trackingId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);

    let trackedHtml = wrapLinks(htmlBody, trackingId);
    trackedHtml = addTrackingPixel(trackedHtml, trackingId);

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

// ---------------------------------------------------------------------------
// Automated cold outreach cron
// ---------------------------------------------------------------------------

async function handleAutoCron(req, res) {
  // Verify Vercel Cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers["authorization"] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const newIds = await redis(["SMEMBERS", "contacts:status:new"]);

    if (!newIds || newIds.length === 0) {
      return res.status(200).json({ processed: 0, sent: 0, message: "No new contacts" });
    }

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

    const scraperContacts = contacts.filter(
      (c) => c.source === "scraper" && c.status === "new" && c.email && !isJunkEmail(c.email)
    );

    let totalSent = 0;
    const results = [];

    for (let i = 0; i < scraperContacts.length; i++) {
      const contact = scraperContacts[i];
      if (totalSent >= DAILY_CAP) break;

      if (i > 0) await new Promise((r) => setTimeout(r, 1000));

      const sentFlag = `outreach-auto:sent:${contact.id}`;
      const alreadySent = await redis(["GET", sentFlag]);
      if (alreadySent) continue;

      const vertical = parseVertical(contact);
      const location = parseLocation(contact.notes);
      const template = getTemplate(contact.industry, vertical, contact.company, location);

      try {
        const trackingId = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
        const fullHtml = emailWrapper(template.body, trackingId);

        const emailData = await sendEmail(contact.email, template.subject, fullHtml);

        const ts = Date.now();
        const timestamp = new Date().toISOString();

        await redisPipeline([
          ["SET", sentFlag, "1"],
          [
            "HSET", `outreach:${trackingId}`,
            "trackingId", trackingId,
            "contactId", contact.id,
            "email", contact.email,
            "subject", template.subject,
            "subjectVariant", String(template.subjectVariant),
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
          ["HSET", `contact:${contact.id}`, "status", "contacted", "updatedAt", timestamp],
          ["ZADD", "contacts:index", ts.toString(), contact.id],
          ["SREM", "contacts:status:new", contact.id],
          ["SADD", "contacts:status:contacted", contact.id],
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
}

// ===========================================================================
// Shared helpers
// ===========================================================================

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

function emailWrapper(bodyHtml, trackingId) {
  // Replace __TID__ placeholder with actual tracking ID BEFORE wrapping links,
  // so the destination URL carries the tracking ID through the click-tracker redirect
  const withTid = bodyHtml.replace(/__TID__/g, trackingId);
  const tracked = wrapLinks(withTid, trackingId);
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
      <p style="font-size: 11px; color: #cbd5e1; margin: 8px 0 0;">Don't want emails from us? <a href="mailto:hello@entityping.com?subject=Unsubscribe&body=Please%20remove%20me%20from%20your%20mailing%20list." style="color: #94a3b8; text-decoration: underline;">Unsubscribe</a></p>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Auto-outreach template helpers
// ---------------------------------------------------------------------------

function parseLocation(notes) {
  const match = (notes || "").match(/Location:\s*([^|]+)/);
  return match ? match[1].trim() : "";
}

function parseVertical(contact) {
  if (contact.vertical) return contact.vertical;
  const match = (contact.notes || "").match(/Vertical:\s*([^|]+)/);
  return match ? match[1].trim() : "";
}

function pickVariant(subjects) {
  const idx = Math.floor(Math.random() * subjects.length);
  return { subject: subjects[idx], subjectVariant: idx };
}

function getTemplate(industry, vertical, businessName, location) {
  const city = location.split(",")[0].trim() || "your area";
  const ind = (industry || "").toLowerCase();

  // CTA links to auto-sample endpoint — sample is delivered instantly on click
  // __TID__ placeholder is replaced with actual tracking ID in emailWrapper()
  // before wrapLinks() processes it, so ?t= survives the click-tracker redirect
  const ctaUrl = "https://entityping.com/api/sample?t=__TID__";
  const signoff = `<p style="font-size: 14px; line-height: 1.6; margin: 16px 0 0; color: #64748b;">&mdash; James, EntityPing</p>`;

  if (ind.includes("insurance")) {
    const subjects = [
      `New LLCs in ${city} need insurance — free lead list`,
      `Your next policyholder just filed in ${city}`,
      `${city} businesses registered this week`,
    ];
    const { subject, subjectVariant } = pickVariant(subjects);
    return {
      subject,
      subjectVariant,
      body: `
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi there,</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Dozens of new LLCs registered in ${city} this week. Every one of them needs GL, BOP, and workers' comp &mdash; and most haven't been contacted yet.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">We pull these leads from state filings daily and deliver them as a clean CSV with owner names, phone numbers, and addresses. You call them before your competition knows they exist.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">Click below and we'll send you 25 real leads instantly &mdash; no form, no commitment:</p>

        <a href="${ctaUrl}" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">Send Me 25 Free Leads</a>

        ${signoff}`,
    };
  }

  if (ind.includes("supplier") || ind.includes("distributor")) {
    const subjects = [
      `New businesses in ${city} need suppliers`,
      `${city} startups signing vendor contracts this week`,
      `First-week businesses in ${city} need you`,
    ];
    const { subject, subjectVariant } = pickVariant(subjects);
    return {
      subject,
      subjectVariant,
      body: `
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi there,</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">New businesses in ${city} are choosing suppliers right now &mdash; before they lock in long-term contracts. The earlier you reach them, the better your odds.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">We deliver fresh business leads daily from state filings and industry directories. Each CSV includes the business name, owner, phone number, address, and industry.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">See real data &mdash; we'll send you 25 leads instantly:</p>

        <a href="${ctaUrl}" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">Send Me 25 Free Leads</a>

        ${signoff}`,
    };
  }

  if (ind.includes("marketing")) {
    const subjects = [
      `New businesses in ${city} need marketing help`,
      `${city} LLC filings are up — ready-to-close leads`,
      `Fresh ${city} business registrations`,
    ];
    const { subject, subjectVariant } = pickVariant(subjects);
    return {
      subject,
      subjectVariant,
      body: `
        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi there,</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Every new business that registers needs customers &mdash; and marketing budgets get allocated in the first weeks. If you're not in front of them, someone else is.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">We deliver fresh business leads daily from state filings across ${city} and beyond. Owner names, phone numbers, addresses, and industry tags &mdash; all in a clean CSV ready for your CRM.</p>

        <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">Click below and we'll send you 25 real leads instantly:</p>

        <a href="${ctaUrl}" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">Send Me 25 Free Leads</a>

        ${signoff}`,
    };
  }

  // Default: B2B Sales
  const subjects = [
    `Fresh business leads in ${city}`,
    `New companies in ${city} need vendors like you`,
    `${city} new business filings — free sample`,
  ];
  const { subject, subjectVariant } = pickVariant(subjects);
  return {
    subject,
    subjectVariant,
    body: `
      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi there,</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">New businesses register every day in ${city}, and in their first weeks they're actively choosing service providers. The window to reach them is short.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">We deliver fresh leads daily from state filings and industry directories &mdash; business name, owner, phone number, address, and industry &mdash; as a clean CSV you can load into any CRM.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">Click below and we'll send you 25 real leads instantly &mdash; no form, no commitment:</p>

      <a href="${ctaUrl}" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">Send Me 25 Free Leads</a>

      ${signoff}`,
  };
}
