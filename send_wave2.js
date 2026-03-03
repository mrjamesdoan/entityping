#!/usr/bin/env node
// Send Wave 2 outreach emails — one per contact, using vertical-specific templates
const fs = require("fs");

const BASE_URL = "https://entityping.com";
const PASSWORD = "73f19497fa196de2fc274ac9b40942e11a9fb5d56b26bccd";

// ─── Templates (same as admin.html) ───
const TEMPLATES = {
  insurance: {
    subject: "{{firstName}}, 25 new Florida businesses registered this week",
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
  <div style="padding: 32px 0; border-bottom: 1px solid #e2e8f0;">
    <span style="font-size: 20px; font-weight: 700; color: #0f172a;">Entity<span style="color: #1486f5;">Ping</span></span>
  </div>
  <div style="padding: 32px 0;">
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi {{firstName}},</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">New businesses need insurance from day one &mdash; GL, BOP, workers&rsquo; comp, commercial auto. The question is who gets to them first.</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">EntityPing monitors state filings, industry directories, and permit records daily and delivers fresh business leads straight to your inbox. Each lead includes the owner&rsquo;s name, full address, phone number, industry, and filing date.</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;"><strong>The data is fully customisable</strong> &mdash; we can filter by entity type (LLC, Corp, DBA), industry vertical, geography, and filing date range so you only see prospects relevant to {{company}}.</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">I&rsquo;ve attached a free sample of 25 Grade-A leads from this week. Take a look and let me know if this is useful &mdash; happy to set up a custom feed for your agency.</p>
    <a href="https://entityping.com/#pricing" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">View Sample Data &amp; Pricing</a>
  </div>
  <div style="padding: 24px 0; border-top: 1px solid #e2e8f0;">
    <p style="font-size: 13px; color: #94a3b8; margin: 0;">EntityPing &mdash; Targeted business leads, delivered daily.<br>
    <a href="https://entityping.com" style="color: #1486f5; text-decoration: none;">entityping.com</a></p>
  </div>
</div>`,
  },
  suppliers: {
    subject: "{{firstName}}, find every new business in your market",
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
  <div style="padding: 32px 0; border-bottom: 1px solid #e2e8f0;">
    <span style="font-size: 20px; font-weight: 700; color: #0f172a;">Entity<span style="color: #1486f5;">Ping</span></span>
  </div>
  <div style="padding: 32px 0;">
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi {{firstName}},</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Every new business that opens is a potential account for {{company}}. The challenge is finding them before they&rsquo;ve already locked in a supplier.</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">EntityPing pulls from state filings, industry directories, and permit records to build targeted business lists by vertical and geography. Whether it&rsquo;s tile showrooms in South Florida, auto shops in Tampa, or restaurants across the state &mdash; we surface them daily with owner names, addresses, and phone numbers.</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;"><strong>Every feed is custom-filtered</strong> to match your exact market &mdash; specific industries, regions, and business types so you&rsquo;re only seeing prospects that matter.</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">I put together a free sample of 25 recent leads. Have a look and tell me what verticals and areas you&rsquo;d want to track &mdash; I&rsquo;ll build a custom feed for your team.</p>
    <a href="https://entityping.com/#pricing" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">View Sample Data &amp; Pricing</a>
  </div>
  <div style="padding: 24px 0; border-top: 1px solid #e2e8f0;">
    <p style="font-size: 13px; color: #94a3b8; margin: 0;">EntityPing &mdash; Targeted business leads, delivered daily.<br>
    <a href="https://entityping.com" style="color: #1486f5; text-decoration: none;">entityping.com</a></p>
  </div>
</div>`,
  },
  marketing: {
    subject: "{{firstName}}, build client prospect lists 10x faster",
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
  <div style="padding: 32px 0; border-bottom: 1px solid #e2e8f0;">
    <span style="font-size: 20px; font-weight: 700; color: #0f172a;">Entity<span style="color: #1486f5;">Ping</span></span>
  </div>
  <div style="padding: 32px 0;">
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi {{firstName}},</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">If {{company}} runs campaigns for local businesses, you know how much time goes into building prospect lists. EntityPing handles that for you.</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">We aggregate data from state business filings, industry directories, and permit records to deliver hyper-targeted lead lists by industry and geography. Every record includes the business name, owner, full address, phone number, and industry classification.</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;"><strong>Feeds are fully customisable</strong> &mdash; filter by industry vertical, geography, entity type, and date range. Perfect for building client-specific outreach lists at scale.</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">Here&rsquo;s a free sample of 25 recent leads to show the data quality. If this looks useful, reply and I&rsquo;ll set up a custom feed matching your clients&rsquo; verticals.</p>
    <a href="https://entityping.com/#pricing" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">View Sample Data &amp; Pricing</a>
  </div>
  <div style="padding: 24px 0; border-top: 1px solid #e2e8f0;">
    <p style="font-size: 13px; color: #94a3b8; margin: 0;">EntityPing &mdash; Targeted business leads, delivered daily.<br>
    <a href="https://entityping.com" style="color: #1486f5; text-decoration: none;">entityping.com</a></p>
  </div>
</div>`,
  },
  b2b: {
    subject: "{{firstName}}, fresh daily leads for {{company}}",
    html: `<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b;">
  <div style="padding: 32px 0; border-bottom: 1px solid #e2e8f0;">
    <span style="font-size: 20px; font-weight: 700; color: #0f172a;">Entity<span style="color: #1486f5;">Ping</span></span>
  </div>
  <div style="padding: 32px 0;">
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">Hi {{firstName}},</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">New businesses are registering every day &mdash; and each one is a potential customer for {{company}}. The key is reaching them while they&rsquo;re still setting up and making buying decisions.</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;">EntityPing monitors state filings, industry directories, and permit records across multiple states and delivers targeted leads daily. Every lead includes the owner&rsquo;s name, mailing address, phone number, industry, and entity type.</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 16px;"><strong>Your feed is custom-built</strong> &mdash; filtered by the specific industries, geographies, and business types most relevant to your sales team. No noise, just qualified prospects.</p>
    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 24px;">I&rsquo;ve put together a sample of 25 recent leads so you can see the data firsthand. Reply with the verticals and regions your team targets and I&rsquo;ll build a custom pipeline for you.</p>
    <a href="https://entityping.com/#pricing" style="display: inline-block; background: #1486f5; color: white; font-weight: 600; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-size: 15px;">View Sample Data &amp; Pricing</a>
  </div>
  <div style="padding: 24px 0; border-top: 1px solid #e2e8f0;">
    <p style="font-size: 13px; color: #94a3b8; margin: 0;">EntityPing &mdash; Targeted business leads, delivered daily.<br>
    <a href="https://entityping.com" style="color: #1486f5; text-decoration: none;">entityping.com</a></p>
  </div>
</div>`,
  },
};

// Map industry field → template key
function getTemplateKey(industry) {
  const lower = (industry || "").toLowerCase();
  if (lower.includes("insurance")) return "insurance";
  if (lower.includes("supplier") || lower.includes("distributor")) return "suppliers";
  if (lower.includes("marketing")) return "marketing";
  if (lower.includes("b2b")) return "b2b";
  return "b2b"; // fallback
}

function resolveTemplate(text, contact) {
  const firstName = (contact.name || "").split(" ")[0] || "there";
  const company = contact.company || "your company";
  return text.replace(/\{\{firstName\}\}/g, firstName).replace(/\{\{company\}\}/g, company);
}

async function main() {
  // 1. Authenticate
  console.log("Authenticating with EntityPing CRM...");
  const authRes = await fetch(`${BASE_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
    redirect: "manual",
  });

  const setCookie = authRes.headers.get("set-cookie");
  if (!setCookie) {
    console.error("Auth failed — no cookie received");
    process.exit(1);
  }
  const cookie = setCookie.split(";")[0];
  console.log("Authenticated.\n");

  // 2. Get contacts with status "new"
  console.log("Fetching contacts with status 'new'...");
  const contactsRes = await fetch(`${BASE_URL}/api/contacts?status=new`, {
    headers: { Cookie: cookie },
  });
  const contacts = await contactsRes.json();

  // Filter out test contacts (jhdoan@gmail.com)
  const eligible = contacts.filter(c => !c.email.includes("jhdoan@gmail.com"));
  console.log(`Found ${eligible.length} eligible contacts (${contacts.length} total, filtered test contacts)\n`);

  if (eligible.length === 0) {
    console.log("No contacts to send to. All may have already been contacted.");
    process.exit(0);
  }

  // 3. Send emails
  let sent = 0;
  let failed = 0;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const contact of eligible) {
    const templateKey = getTemplateKey(contact.industry);
    const template = TEMPLATES[templateKey];

    const subject = resolveTemplate(template.subject, contact);
    const htmlBody = resolveTemplate(template.html, contact);

    try {
      const res = await fetch(`${BASE_URL}/api/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          contactId: contact.id,
          subject,
          htmlBody,
        }),
      });

      const result = await res.json();

      if (result.success) {
        sent++;
        console.log(`  ✓ [${sent}/${eligible.length}] ${contact.name || "?"} <${contact.email}> [${templateKey}]`);
      } else {
        failed++;
        console.log(`  ✗ FAILED: ${contact.email} — ${JSON.stringify(result)}`);
      }
    } catch (err) {
      failed++;
      console.log(`  ✗ ERROR: ${contact.email} — ${err.message}`);
    }

    // Rate limit: 500ms between sends to avoid Resend throttling
    await delay(500);
  }

  console.log(`\n--- Wave 2 Outreach Complete ---`);
  console.log(`Sent: ${sent}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${eligible.length}`);
}

main().catch(console.error);
