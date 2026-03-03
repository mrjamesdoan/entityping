#!/usr/bin/env node
// Import Wave 2 prospects into EntityPing CRM
const fs = require("fs");

const BASE_URL = "https://entityping.com";
const PASSWORD = "73f19497fa196de2fc274ac9b40942e11a9fb5d56b26bccd";

async function main() {
  // 1. Authenticate and get cookie
  console.log("Authenticating...");
  const authRes = await fetch(`${BASE_URL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASSWORD }),
    redirect: "manual",
  });

  const setCookie = authRes.headers.get("set-cookie");
  if (!setCookie) {
    console.error("Auth failed — no cookie received");
    console.error("Status:", authRes.status, await authRes.text());
    process.exit(1);
  }

  // Extract just the cookie value
  const cookie = setCookie.split(";")[0];
  console.log("Authenticated successfully\n");

  // 2. Load prospects
  const data = JSON.parse(
    fs.readFileSync("/home/alpha/projects/entityping/prospects_wave2.json", "utf8")
  );

  const allContacts = [
    ...data.insurance,
    ...data.suppliers,
    ...data.marketing,
    ...data.b2b_sales,
  ];

  console.log(`Importing ${allContacts.length} contacts...\n`);

  let created = 0;
  let existing = 0;
  let failed = 0;

  for (const contact of allContacts) {
    try {
      const res = await fetch(`${BASE_URL}/api/contacts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({
          name: contact.name,
          email: contact.email,
          company: contact.company,
          industry: contact.industry,
          source: "outreach",
          notes: contact.vertical ? `Vertical: ${contact.vertical}` : "",
        }),
      });

      const result = await res.json();

      if (result.existing) {
        existing++;
        console.log(`  SKIP (exists): ${contact.email}`);
      } else if (result.contact) {
        created++;
        console.log(`  ✓ Created: ${contact.name} <${contact.email}> [${contact.industry}]`);
      } else {
        failed++;
        console.log(`  ✗ Failed: ${contact.email} — ${JSON.stringify(result)}`);
      }
    } catch (err) {
      failed++;
      console.log(`  ✗ Error: ${contact.email} — ${err.message}`);
    }
  }

  console.log(`\n--- Import Complete ---`);
  console.log(`Created: ${created}`);
  console.log(`Already existed: ${existing}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total processed: ${allContacts.length}`);
}

main().catch(console.error);
