// Unified stats endpoint — handles dashboard stats and submission logs
// GET /api/stats → dashboard metrics
// GET /api/stats?view=submissions → submission log entries
// Merges former stats.js + submissions.js into a single serverless function

const { redis, redisPipeline, isAuthed, unauthorized } = require("./_lib/redis");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!isAuthed(req)) return unauthorized(res);

  const view = req.query?.view;

  if (view === "submissions") {
    return handleSubmissions(req, res);
  }

  return handleStats(req, res);
};

// ---------------------------------------------------------------------------
// Dashboard stats
// ---------------------------------------------------------------------------

async function handleStats(req, res) {
  try {
    const results = await redisPipeline([
      ["GET", "stats:outreach_sent"],
      ["GET", "stats:opens"],
      ["GET", "stats:clicks"],
      ["GET", "stats:submissions"],
      ["ZCARD", "contacts:index"],
      ["SCARD", "contacts:status:new"],
      ["SCARD", "contacts:status:contacted"],
      ["SCARD", "contacts:status:opened"],
      ["SCARD", "contacts:status:clicked"],
      ["SCARD", "contacts:status:replied"],
      ["SCARD", "contacts:status:converted"],
    ]);

    const val = (i) => parseInt(results[i]?.result) || 0;

    return res.status(200).json({
      outreachSent: val(0),
      opens: val(1),
      clicks: val(2),
      submissions: val(3),
      totalContacts: val(4),
      byStatus: {
        new: val(5),
        contacted: val(6),
        opened: val(7),
        clicked: val(8),
        replied: val(9),
        converted: val(10),
      },
    });
  } catch (err) {
    console.error("Stats error:", err.message);
    return res.status(500).json({ error: "Failed to fetch stats" });
  }
}

// ---------------------------------------------------------------------------
// Submission log
// ---------------------------------------------------------------------------

async function handleSubmissions(req, res) {
  try {
    const raw = await redis([
      "ZREVRANGE", "submissions:log", "0", "99", "WITHSCORES",
    ]);

    const submissions = [];
    if (raw) {
      for (let i = 0; i < raw.length; i += 2) {
        try {
          const sub = JSON.parse(raw[i]);
          sub._score = raw[i + 1];
          submissions.push(sub);
        } catch (e) {
          // skip malformed
        }
      }
    }

    return res.status(200).json(submissions);
  } catch (err) {
    console.error("Submissions error:", err.message);
    return res.status(500).json({ error: "Failed to fetch submissions" });
  }
}
