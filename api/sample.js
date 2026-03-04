// Vercel Serverless Function — /api/sample
// POST /api/sample         → form submission (organic visitors)
// GET  /api/sample?t=...   → auto-deliver for outreach recipients (no form needed)

const crypto = require("crypto");

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = "hello@alphacraft.dev";
const FROM_EMAIL = "EntityPing <hello@entityping.com>";
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

// The 25-lead sample CSV embedded directly
const SAMPLE_CSV = `business_name,entity_type,filing_date,state,owner_name,address,city,state_abbr,zip,phone,industry,quality_score
Cruz Renovations,DBA,2026-02-22,FL,Oliver Cruz,7901 Baymeadows Cir E,Jacksonville,FL,32256,(904) 381-4728,Construction,A
Strong Steps Remodelation LLC,LLC,2026-02-20,FL,Leodan Martinez,756 Cape Cod Cir,Valrico,FL,33594,(813) 247-9031,Construction,A
Setai 3706 Realty LLC,LLC,2026-02-24,FL,Mark Militana,1101 West Franklin Street,Richmond,VA,23220,(804) 619-3472,Real Estate,A
Fabulously Made Salon & Hair Loss Solutions,DBA,2026-02-24,FL,Johanna Amarante,8909 Regents Park Drive,Tampa,FL,33647,(813) 472-8163,Beauty & Wellness,A
DeRosier Legal LLC,LLC,2026-02-26,FL,Jeff DeRosier,200 Elm Ave,Satellite Beach,FL,32937,(321) 718-4295,Professional Services,A
WCMT Studios,DBA,2026-02-20,FL,John Lemis,10834 Kentworth Way,Jacksonville,FL,32256,(904) 263-8741,Entertainment,A
JGNS Notary and Tax Services,DBA,2026-02-25,FL,Betsy Gutierrez,2416 Metro Drive,Ruskin,FL,33570,(813) 594-7218,Professional Services,A
Gringa Studio LLC,LLC,2026-02-24,FL,Isadora Cardoso Bernardes,7950 NE Bayshore Ct,Miami,FL,33138,(305) 841-3267,Entertainment,A
Mind Mechanic RX,DBA,2026-02-24,FL,Mind Mechanic LLC,7777 Glades Rd,Boca Raton,FL,33434,(561) 329-4781,Automotive,A
Cleaning Services by AVM LLC,LLC,2026-03-01,FL,Adriana Valladares Menendez,1698 Nabatoff,North Port,FL,34288,(941) 217-8364,Cleaning,A
DJ Negro Loko,DBA,2026-02-26,FL,Alta Gama Productions LLC,690 Champions Gate Blvd,Deland,FL,32724,(386) 741-2958,Entertainment,A
Brassworks Bodyshop Auto Collision & Sales,DBA,2026-02-26,FL,Brassworks LLC,1335 West Washington Street Unit 1A,Orlando,FL,32805,(407) 328-6714,Retail,A
Dade City Food and Fuel,DBA,2026-02-26,FL,Rainbow Food Mart of Dade City LLC,34550 Blenton Road,Dade City,FL,33523,(352) 481-7293,Food Service,A
Trillium Construction Group LLC,LLC,2026-03-01,FL,Denis Stephenson,16304 2nd St E,Redington Beach,FL,33708,(727) 394-8162,Construction,A
NextAxis Consulting LLC,LLC,2026-02-28,FL,Carmen Rojas Gines,51 Pine Trace Loop,Ocala,FL,34472,(352) 617-2849,Professional Services,A
West Orange Park Properties XXL LLC,LLC,2026-02-20,FL,West Orange Holdings LLC,1253 E. Fullers Cross Road,Winter Garden,FL,34787,(407) 582-3197,Real Estate,A
Dent-Tech Studio,DBA,2026-02-25,FL,Juan Jose Polanco,12 SW 250th Street,Newberry,FL,32669,(352) 748-1936,Technology,A
Effata Contracting Inc,Corp,2026-02-23,FL,Pedro Juan Rodriguez,2927 Lincoln Blvd,Fort Myers,FL,33916,(239) 481-7263,Construction,A
Key Raton Realty LLC,LLC,2026-03-01,FL,Brad Senatore,1121 Crandon Blvd,Key Biscayne,FL,33149,(305) 917-4382,Real Estate,A
Certified Jewelers,DBA,2026-02-20,FL,Certification Marketing Consultants Inc,2314 Immokalee Road,Naples,FL,34110,(239) 362-8147,Retail,A
Portable Networks,DBA,2026-02-23,FL,Alan Bowley,1711 SW 99 Avenue,Miami,FL,33165,(305) 274-9183,Technology,A
Elite Pro Mobile Detailing LLC,LLC,2026-02-23,FL,Pascual Cardona,1259 March Lane,LaBelle,FL,33935,(863) 412-7893,Automotive,A
New Beginnings Chiropractic & Wellness LLC,LLC,2026-02-24,FL,Brian Perez,7422 SW 42nd Ter,Miami,FL,33155,(305) 693-2748,Healthcare,A
Yuri Handyman and Remodeling LLC,LLC,2026-02-24,FL,Yunior Ramon Diaz Souliz,1152 NW 37th St,Miami,FL,33127,(786) 341-8927,Construction,A
Ojeda Transport Services Corp,Corp,2026-02-20,FL,Jose Ramon Garcia Ojeda,111 NW 183 St Ste 318-C,Miami Gardens,FL,33169,(305) 829-4176,Logistics,A`;

async function sendEmail(to, subject, html, attachments = []) {
  const body = {
    from: FROM_EMAIL,
    to,
    subject,
    html,
  };
  if (attachments.length > 0) {
    body.attachments = attachments;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Resend error: ${res.status} ${err}`);
  }

  return res.json();
}

async function redisPipeline(commands) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const res = await fetch(`${REDIS_URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis pipeline error: ${res.status}`);
  return res.json();
}

async function redisCmd(command) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Redis error: ${res.status}`);
  const data = await res.json();
  return data.result;
}

// ---------------------------------------------------------------------------
// Sample email HTML
// ---------------------------------------------------------------------------

function sampleEmailHtml(firstName) {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
    <div style="padding: 32px 0; border-bottom: 1px solid #e2e8f0;">
      <span style="font-size: 20px; font-weight: 700; color: #0f172a;">Entity<span style="color: #1486f5;">Ping</span></span>
    </div>

    <div style="padding: 32px 0;">
      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${firstName},</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Your <strong>25 Grade-A business leads</strong> are attached. These are real businesses that filed in Florida this week &mdash; every one is a potential customer who's actively setting up operations and looking for vendors.</p>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px 20px; margin: 0 0 20px;">
        <p style="font-size: 14px; font-weight: 600; color: #0f172a; margin: 0 0 8px;">Here's what to do right now:</p>
        <ol style="font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px; color: #475569;">
          <li>Open the attached CSV in Excel or Google Sheets</li>
          <li>Filter by the industries you serve</li>
          <li>Pick 5 leads and reach out today &mdash; a quick call or email while they're still in setup mode</li>
        </ol>
      </div>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">These 25 leads came from <strong>just one day</strong> of filings. Hundreds more register every single day &mdash; and the ones you don't reach first go to your competitors.</p>

      <p style="font-size: 16px; line-height: 1.6; margin: 0 0 8px;">When you're ready for a daily feed, our Growth plan delivers <strong>up to 600 leads per month</strong> filtered to your exact industries and locations.</p>

      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px 20px; margin: 16px 0 24px;">
        <p style="font-size: 14px; line-height: 1.5; margin: 0; color: #166534;"><strong>First-month offer:</strong> Use code <strong style="font-family: monospace; background: white; padding: 2px 6px; border-radius: 4px; border: 1px solid #d1d5db;">FIRST50</strong> at checkout for <strong>50% off</strong> &mdash; that's the Growth plan for just $49.50.</p>
      </div>

      <a href="https://entityping.com/checkout?plan=growth&billing=monthly" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-size: 15px;">Start Getting Daily Leads &mdash; 50% Off</a>

      <p style="font-size: 14px; line-height: 1.6; margin: 16px 0 0; color: #64748b;">Questions? Just reply to this email &mdash; I read every one personally.<br>&mdash; James, EntityPing</p>
    </div>

    <div style="padding: 24px 0; border-top: 1px solid #e2e8f0;">
      <p style="font-size: 13px; color: #94a3b8; margin: 0;">EntityPing &mdash; Targeted business leads, delivered daily.<br>
      <a href="https://entityping.com" style="color: #1486f5; text-decoration: none;">entityping.com</a></p>
      <p style="font-size: 11px; color: #cbd5e1; margin: 8px 0 0;">Don't want emails from us? <a href="mailto:hello@entityping.com?subject=Unsubscribe&body=Please%20remove%20me%20from%20your%20mailing%20list." style="color: #94a3b8; text-decoration: underline;">Unsubscribe</a></p>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// GET /api/sample?t=trackingId — auto-deliver for outreach click-throughs
// ---------------------------------------------------------------------------

async function handleAutoSample(req, res) {
  const trackingId = req.query?.t;

  if (!trackingId) {
    return res.redirect(302, "https://entityping.com/#free-sample");
  }

  try {
    // Look up outreach record to get email
    const raw = await redisCmd(["HGETALL", `outreach:${trackingId}`]);
    if (!raw || raw.length === 0) {
      return res.redirect(302, "https://entityping.com/#free-sample");
    }

    const outreach = {};
    for (let i = 0; i < raw.length; i += 2) {
      outreach[raw[i]] = raw[i + 1];
    }

    const email = outreach.email;
    if (!email) {
      return res.redirect(302, "https://entityping.com/#free-sample");
    }

    // Check if we already sent this person a sample
    const alreadySent = await redisCmd(["GET", `sample:sent:${email}`]);
    if (alreadySent) {
      // Already sent — just redirect to thank-you page
      return res.redirect(302, "https://entityping.com/sample-sent");
    }

    // Look up contact name
    const contactId = outreach.contactId;
    let firstName = "there";
    if (contactId) {
      const contactName = await redisCmd(["HGET", `contact:${contactId}`, "name"]);
      if (contactName) {
        firstName = contactName.split(" ")[0] || "there";
      }
    }

    // Send sample
    const csvBase64 = Buffer.from(SAMPLE_CSV).toString("base64");
    await sendEmail(
      email,
      `${firstName}, your 25 leads are here — open them now`,
      sampleEmailHtml(firstName),
      [{ filename: "entityping_sample_25_leads.csv", content: csvBase64 }]
    );

    // Mark as sent + log conversion
    const ts = Date.now();
    const timestamp = new Date().toISOString();

    const pipeline = [
      ["SET", `sample:sent:${email}`, "1"],
      ["INCR", "stats:submissions"],
      ["INCR", "stats:auto_samples"],
    ];

    // Record conversion event on outreach
    pipeline.push(
      ["HSET", `outreach:${trackingId}`, "converted", "1", "convertedAt", timestamp]
    );

    // Log event on contact
    if (contactId) {
      pipeline.push(
        ["ZADD", `contact:${contactId}:events`, ts.toString(),
          JSON.stringify({
            type: "sample_auto_delivered",
            timestamp,
            data: { trackingId, source: "outreach_click" },
          }),
        ],
        ["HSET", `contact:${contactId}`, "status", "converted", "updatedAt", timestamp],
        ["SREM", `contacts:status:clicked`, contactId],
        ["SREM", `contacts:status:opened`, contactId],
        ["SREM", `contacts:status:contacted`, contactId],
        ["SADD", "contacts:status:converted", contactId],
        ["ZADD", "contacts:index", ts.toString(), contactId]
      );
    }

    await redisPipeline(pipeline);

    // Notify us
    try {
      await sendEmail(
        NOTIFY_EMAIL,
        `[EntityPing] Auto-sample delivered: ${email}`,
        `<div style="font-family: monospace; font-size: 14px; line-height: 1.8; color: #1e293b;">
          <p><strong>Auto-sample delivered (outreach click-through)</strong></p>
          <p>Email: ${email}<br>
          Tracking ID: ${trackingId}<br>
          Contact ID: ${contactId || "N/A"}<br>
          Time: ${timestamp}</p>
        </div>`
      );
    } catch (notifyErr) {
      console.error("Notify error:", notifyErr.message);
    }

    return res.redirect(302, "https://entityping.com/sample-sent");
  } catch (err) {
    console.error("Auto-sample error:", err.message);
    // Fallback — send to the form
    return res.redirect(302, "https://entityping.com/#free-sample");
  }
}

// ---------------------------------------------------------------------------
// POST /api/sample — form submission (organic visitors)
// ---------------------------------------------------------------------------

async function handleFormSample(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  const { name, email, industry } = req.body || {};

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  const firstName = name ? name.split(" ")[0] : "there";

  try {
    const csvBase64 = Buffer.from(SAMPLE_CSV).toString("base64");

    await sendEmail(
      email,
      `${firstName}, your 25 leads are here — open them now`,
      sampleEmailHtml(firstName),
      [{ filename: "entityping_sample_25_leads.csv", content: csvBase64 }]
    );

    // Notify ourselves
    const industryLabel = industry || "Not specified";
    const timestamp = new Date().toISOString();

    await sendEmail(
      NOTIFY_EMAIL,
      `[EntityPing] New sample request: ${email}`,
      `<div style="font-family: monospace; font-size: 14px; line-height: 1.8; color: #1e293b;">
        <p><strong>New EntityPing Lead (form submission)</strong></p>
        <p>Name: ${name || "N/A"}<br>
        Email: ${email}<br>
        Industry interest: ${industryLabel}<br>
        Time: ${timestamp}</p>
      </div>`
    );

    // Log to Redis CRM
    try {
      const ts = Date.now();
      const subId = crypto.randomUUID().slice(0, 8);
      const submission = JSON.stringify({
        id: subId,
        name: name || "",
        email,
        industry: industryLabel,
        timestamp,
      });

      const existingId = await redisCmd(["GET", `contacts:email:${email}`]);

      if (existingId) {
        await redisPipeline([
          ["ZADD", "submissions:log", ts.toString(), submission],
          ["ZADD", `contact:${existingId}:events`, ts.toString(),
            JSON.stringify({
              type: "form_submitted",
              timestamp,
              data: { name: name || "", industry: industryLabel },
            }),
          ],
          ["HSET", `contact:${existingId}`, "updatedAt", timestamp],
          ["ZADD", "contacts:index", ts.toString(), existingId],
          ["INCR", "stats:submissions"],
          ["SET", `sample:sent:${email}`, "1"],
        ]);
      } else {
        await redisPipeline([
          ["ZADD", "submissions:log", ts.toString(), submission],
          ["HSET", `contact:${subId}`,
            "id", subId,
            "name", name || "",
            "email", email,
            "company", "",
            "status", "new",
            "source", "form_submission",
            "industry", industryLabel,
            "createdAt", timestamp,
            "updatedAt", timestamp,
            "notes", "",
          ],
          ["ZADD", "contacts:index", ts.toString(), subId],
          ["SADD", "contacts:status:new", subId],
          ["SET", `contacts:email:${email}`, subId],
          ["ZADD", `contact:${subId}:events`, ts.toString(),
            JSON.stringify({
              type: "form_submitted",
              timestamp,
              data: { name: name || "", industry: industryLabel },
            }),
          ],
          ["INCR", "stats:submissions"],
          ["SET", `sample:sent:${email}`, "1"],
        ]);
      }
    } catch (redisErr) {
      console.error("Redis logging failed:", redisErr.message);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: "Failed to send sample. Please try again." });
  }
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

  if (req.method === "GET") return handleAutoSample(req, res);
  if (req.method === "POST") return handleFormSample(req, res);
  return res.status(405).json({ error: "Method not allowed" });
};
