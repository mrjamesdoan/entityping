// Vercel Serverless Function — POST /api/sample
// Sends free 25-lead sample via Resend and notifies us

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = "hello@alphacraft.dev";
const FROM_EMAIL = "EntityPing <hello@entityping.com>";

// The 25-lead sample CSV embedded directly
const SAMPLE_CSV = `business_name,entity_type,filing_date,state,owner_name,address,city,state_abbr,zip,industry,quality_score
Cruz Renovations,DBA,2026-02-22,FL,Oliver Cruz,7901 Baymeadows Cir E,Jacksonville,FL,32256,Construction,A
Strong Steps Remodelation LLC,LLC,2026-02-20,FL,Leodan Martinez,756 Cape Cod Cir,Valrico,FL,33594,Construction,A
Setai 3706 Realty LLC,LLC,2026-02-24,FL,Mark Militana,1101 West Franklin Street,Richmond,VA,23220,Real Estate,A
Fabulously Made Salon & Hair Loss Solutions,DBA,2026-02-24,FL,Johanna Amarante,8909 Regents Park Drive,Tampa,FL,33647,Beauty & Wellness,A
DeRosier Legal LLC,LLC,2026-02-26,FL,Jeff DeRosier,200 Elm Ave,Satellite Beach,FL,32937,Professional Services,A
WCMT Studios,DBA,2026-02-20,FL,John Lemis,10834 Kentworth Way,Jacksonville,FL,32256,Entertainment,A
JGNS Notary and Tax Services,DBA,2026-02-25,FL,Betsy Gutierrez,2416 Metro Drive,Ruskin,FL,33570,Professional Services,A
Gringa Studio LLC,LLC,2026-02-24,FL,Isadora Cardoso Bernardes,7950 NE Bayshore Ct,Miami,FL,33138,Entertainment,A
Mind Mechanic RX,DBA,2026-02-24,FL,Mind Mechanic LLC,7777 Glades Rd,Boca Raton,FL,33434,Automotive,A
Cleaning Services by AVM LLC,LLC,2026-03-01,FL,Adriana Valladares Menendez,1698 Nabatoff,North Port,FL,34288,Cleaning,A
DJ Negro Loko,DBA,2026-02-26,FL,Alta Gama Productions LLC,690 Champions Gate Blvd,Deland,FL,32724,Entertainment,A
Brassworks Bodyshop Auto Collision & Sales,DBA,2026-02-26,FL,Brassworks LLC,1335 West Washington Street Unit 1A,Orlando,FL,32805,Retail,A
Dade City Food and Fuel,DBA,2026-02-26,FL,Rainbow Food Mart of Dade City LLC,34550 Blenton Road,Dade City,FL,33523,Food Service,A
Trillium Construction Group LLC,LLC,2026-03-01,FL,Denis Stephenson,16304 2nd St E,Redington Beach,FL,33708,Construction,A
NextAxis Consulting LLC,LLC,2026-02-28,FL,Carmen Rojas Gines,51 Pine Trace Loop,Ocala,FL,34472,Professional Services,A
West Orange Park Properties XXL LLC,LLC,2026-02-20,FL,West Orange Holdings LLC,1253 E. Fullers Cross Road,Winter Garden,FL,34787,Real Estate,A
Dent-Tech Studio,DBA,2026-02-25,FL,Juan Jose Polanco,12 SW 250th Street,Newberry,FL,32669,Technology,A
Effata Contracting Inc,Corp,2026-02-23,FL,Pedro Juan Rodriguez,2927 Lincoln Blvd,Fort Myers,FL,33916,Construction,A
Key Raton Realty LLC,LLC,2026-03-01,FL,Brad Senatore,1121 Crandon Blvd,Key Biscayne,FL,33149,Real Estate,A
Certified Jewelers,DBA,2026-02-20,FL,Certification Marketing Consultants Inc,2314 Immokalee Road,Naples,FL,34110,Retail,A
Portable Networks,DBA,2026-02-23,FL,Alan Bowley,1711 SW 99 Avenue,Miami,FL,33165,Technology,A
Elite Pro Mobile Detailing LLC,LLC,2026-02-23,FL,Pascual Cardona,1259 March Lane,LaBelle,FL,33935,Automotive,A
New Beginnings Chiropractic & Wellness LLC,LLC,2026-02-24,FL,Brian Perez,7422 SW 42nd Ter,Miami,FL,33155,Healthcare,A
Yuri Handyman and Remodeling LLC,LLC,2026-02-24,FL,Yunior Ramon Diaz Souliz,1152 NW 37th St,Miami,FL,33127,Construction,A
Ojeda Transport Services Corp,Corp,2026-02-20,FL,Jose Ramon Garcia Ojeda,111 NW 183 St Ste 318-C,Miami Gardens,FL,33169,Logistics,A`;

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

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { name, email, industry } = req.body || {};

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email required" });
  }

  const firstName = name ? name.split(" ")[0] : "there";

  try {
    // 1. Send sample to prospect
    const csvBase64 = Buffer.from(SAMPLE_CSV).toString("base64");

    await sendEmail(
      email,
      "Your free EntityPing sample — 25 Grade-A leads",
      `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
        <div style="padding: 32px 0; border-bottom: 1px solid #e2e8f0;">
          <span style="font-size: 20px; font-weight: 700; color: #0f172a;">Entity<span style="color: #1486f5;">Ping</span></span>
        </div>

        <div style="padding: 32px 0;">
          <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi ${firstName},</p>

          <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Thanks for your interest in EntityPing. Attached is your free sample of <strong>25 Grade-A business leads</strong> from this week's Florida filings.</p>

          <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Each lead includes:</p>

          <ul style="font-size: 15px; line-height: 1.8; margin: 0 0 16px; padding-left: 20px; color: #475569;">
            <li>Business name and entity type (LLC, Corp, DBA)</li>
            <li>Owner / principal name</li>
            <li>Full mailing address</li>
            <li>Industry classification and quality grade</li>
            <li>Filing date</li>
          </ul>

          <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Open the CSV in Excel or Google Sheets and you'll see exactly the kind of data we deliver daily.</p>

          <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">Want a daily feed filtered to your industries? Reply to this email and we'll get you set up.</p>

          <a href="https://entityping.com/#pricing" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">View Plans &amp; Pricing</a>
        </div>

        <div style="padding: 24px 0; border-top: 1px solid #e2e8f0;">
          <p style="font-size: 13px; color: #94a3b8; margin: 0;">EntityPing &mdash; Targeted business leads, delivered daily.<br>
          <a href="https://entityping.com" style="color: #1486f5; text-decoration: none;">entityping.com</a></p>
        </div>
      </div>
      `,
      [
        {
          filename: "entityping_sample_25_leads.csv",
          content: csvBase64,
        },
      ]
    );

    // 2. Notify ourselves
    const industryLabel = industry || "Not specified";
    const timestamp = new Date().toISOString();

    await sendEmail(
      NOTIFY_EMAIL,
      `[EntityPing] New sample request: ${email}`,
      `
      <div style="font-family: monospace; font-size: 14px; line-height: 1.8; color: #1e293b;">
        <p><strong>New EntityPing Lead</strong></p>
        <p>Name: ${name || "N/A"}<br>
        Email: ${email}<br>
        Industry interest: ${industryLabel}<br>
        Time: ${timestamp}</p>
      </div>
      `
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: "Failed to send sample. Please try again." });
  }
}
