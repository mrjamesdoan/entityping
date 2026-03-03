const crypto = require("crypto");
const { redis, redisPipeline, isAuthed, unauthorized } = require("./lib/redis");

// The 12 insurance agents who received outreach on ~2026-03-02
const HISTORICAL_CONTACTS = [
  { name: "Paul", email: "Paul@InsGuy.com", company: "InsGuy Insurance" },
  { name: "Ralph", email: "ralph@prestigeinsurance.com", company: "Prestige Insurance" },
  { name: "Carolyn", email: "carolyn@gstarins.com", company: "G-Star Insurance" },
  { name: "Susie", email: "susier@ggaig.com", company: "GGA Insurance Group" },
  { name: "Nora", email: "nora@saunderstaylor.com", company: "Saunders Taylor" },
  { name: "Steve", email: "steve@alexandergreep.com", company: "Alexander Greep" },
  { name: "Tom", email: "tom@tccassociates.com", company: "TCC Associates" },
  { name: "Grant", email: "grant@gcmins.com", company: "GCM Insurance" },
  { name: "T. Salzsieder", email: "Tsalzsieder@cisllcfl.com", company: "CIS LLC" },
  { name: "Mando", email: "mando@garzorinsurance.com", company: "Garzor Insurance" },
  { name: "Sherri", email: "sherri@etonbridgesolutions.com", company: "Etonbridge Solutions" },
  { name: "Jonathan", email: "jtl@lowryleighinsurance.com", company: "Lowry Leigh Insurance" },
];

const OUTREACH_SUBJECT = "25 freshly-registered Florida businesses — free sample";
const OUTREACH_DATE = "2026-03-02T18:00:00Z";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthed(req)) return unauthorized(res);

  try {
    // Check if already seeded
    const seeded = await redis(["GET", "seed:completed"]);
    if (seeded === "1") {
      return res.status(200).json({ message: "Already seeded", seeded: true });
    }

    const pipeline = [];
    const ts = new Date(OUTREACH_DATE).getTime();

    for (const c of HISTORICAL_CONTACTS) {
      const id = crypto.randomUUID().slice(0, 8);

      // Create contact
      pipeline.push([
        "HSET", `contact:${id}`,
        "id", id,
        "name", c.name,
        "email", c.email,
        "company", c.company,
        "status", "contacted",
        "source", "outreach",
        "industry", "Insurance",
        "createdAt", OUTREACH_DATE,
        "updatedAt", OUTREACH_DATE,
        "notes", "",
      ]);

      // Index
      pipeline.push(["ZADD", "contacts:index", ts.toString(), id]);
      pipeline.push(["SADD", "contacts:status:contacted", id]);
      pipeline.push(["SET", `contacts:email:${c.email}`, id]);

      // Add email_sent event (pre-tracking, historical)
      pipeline.push([
        "ZADD", `contact:${id}:events`, ts.toString(),
        JSON.stringify({
          type: "email_sent",
          timestamp: OUTREACH_DATE,
          data: {
            subject: OUTREACH_SUBJECT,
            note: "Pre-tracking historical outreach — no open/click data available",
          },
        }),
      ]);
    }

    // Set stats
    pipeline.push(["SET", "stats:outreach_sent", HISTORICAL_CONTACTS.length.toString()]);
    pipeline.push(["SET", "seed:completed", "1"]);

    await redisPipeline(pipeline);

    return res.status(200).json({
      success: true,
      message: `Seeded ${HISTORICAL_CONTACTS.length} historical contacts`,
      contacts: HISTORICAL_CONTACTS.map((c) => c.email),
    });
  } catch (err) {
    console.error("Seed error:", err.message);
    return res.status(500).json({ error: "Seed failed: " + err.message });
  }
};
