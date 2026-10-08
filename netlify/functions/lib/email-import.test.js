// node netlify/functions/lib/email-import.test.js — email -> estimate request
const imp = require("./email-import");
let pass = 0, fail = 0; const ok = (n, c, x) => { c ? pass++ : fail++; console.log((c ? "PASS  " : "FAIL  ") + n + (c || x == null ? "" : "\n      " + x)); };
const mail = { from: "dingber@example.org", name: "Rabbi David Ingber", subject: "Upper West Side entryway built-in and French-door project", at: "2026-08-25T14:00:00.000Z", messageId: "<abc@x>", box: "info@sanibuildingcorp.com", text: "Hi..." };
const d = imp.readDraft({ name: "", email: "", phone: "(212) 555-0100", address: "", title: "", description: "- Custom bench 56-58 in\n- Benjamin Moore Gettysburg Gray HC-107" }, mail);
ok("sender fills the name and email the model left empty", d.name === "Rabbi David Ingber" && d.email === "dingber@example.org");
ok("description kept as the model wrote it (lists, color codes)", /HC-107/.test(d.description) && /56-58/.test(d.description));
ok("empty title falls back to the subject", d.title.indexOf("Upper West Side") === 0);
const fw = imp.readDraft({ name: "Jane Roe", email: "jane@roe.com" }, { from: "sanibuildingcorp@gmail.com", name: "Sani", subject: "Fwd: bathroom" });
ok("a forward from Sani uses the ORIGINAL customer, never Sani", fw.name === "Jane Roe" && fw.email === "jane@roe.com");
const fw2 = imp.readDraft({}, { from: "info@sanibuildingcorp.com", name: "Sani Building Corp" });
ok("a forward with no customer found leaves name/email empty for him to type", fw2.name === "" && fw2.email === "");
const bad = imp.readDraft({ email: "not an email" }, mail);
ok("a broken email from the model falls back to the sender", bad.email === "dingber@example.org");
const r = imp.buildRecord("SBC-260825-ABCD", d, mail, ["https://x.supabase.co/a.jpg", "javascript:alert(1)"], "");
ok("record: new email request with the customer and description", r.status === "new" && r.source === "email" && r.customer.name === "Rabbi David Ingber" && /HC-107/.test(r.request.description));
ok("record: only https photos, as request photos", r.request.photos.length === 1 && r.request.photos[0].data === "https://x.supabase.co/a.jpg");
ok("record: link back to the email kept", r.request.emailMessageId === "<abc@x>" && r.request.emailSubject.length > 0);
ok("record: dated when the customer wrote", r.submittedAt === mail.at);
const a = imp.buildRecord("SBC-1", d, mail, [], "sbc-260801-zzzz");
ok("additional work for an existing customer is linked to the parent job", a.parentRef === "SBC-260801-ZZZZ" && a.addon === true);
ok("search: typed words search all dates, empty = last 60 days, promotions left out", /^Ingber /.test(imp.queryFor("Ingber")) && !/newer_than/.test(imp.queryFor("Ingber")) && /newer_than:60d/.test(imp.queryFor("")) && /-category:promotions/.test(imp.queryFor("")));
const rows = [
  { from: "luke@patton.com", name: "Luke Patton", subject: "Re: Thank You + Apartment Walkthrough", at: "2026-10-08T15:00:00Z" },
  { from: "luke@patton.com", name: "Luke Patton", subject: "Re: Thank You + Apartment Walkthrough", at: "2026-10-08T12:00:00Z" },
  { from: "ethan@scda.com", name: "Ethan Chan", subject: "Request for Quote – Existing Kitchenette Relocation", at: "2026-10-08T11:00:00Z" },
  { from: "renewals@samrenewal.org", name: "Renewal Support", subject: "SAM Renewal due - Sani Building Corp", at: "2026-10-08T10:00:00Z" },
  { from: "estimates@sanibuildingcorp.com", name: "Zurabi at Sani Building Corp", subject: "Invoice INV-260925-Z1M3-02 from Sani Building Corp — $600.00", at: "2026-10-08T09:00:00Z" },
  { from: "sanibuildingcorp@gmail.com", name: "Sani Building", subject: "Re: Thank You + Apartment Walkthrough", at: "2026-10-08T08:00:00Z" },
  { from: "alerts@x.com", name: "Sani Building Corp", subject: "SBC-261006-8VB6 — new message from Vanessa Chang", at: "2026-10-06T08:00:00Z" },
  { from: "dingber@example.org", name: "Rabbi David Ingber", subject: "Upper West Side entryway built-in", at: "2026-08-25T14:00:00Z" },
];
const tl = imp.tidy(rows);
ok("his own emails, invoices, alerts and renewal notices are hidden", !tl.some((m) => /sanibuildingcorp|alerts@|renewals@/.test(m.from)), JSON.stringify(tl.map((m) => m.name)));
ok("replies in one conversation are grouped, newest kept, counted", tl.filter((m) => m.name === "Luke Patton").length === 1 && tl[0].count === 2 && tl[0].at === "2026-10-08T15:00:00Z");
ok("real requests stay, newest first", tl.map((m) => m.name).join(",") === "Luke Patton,Ethan Chan,Rabbi David Ingber", tl.map((m) => m.name).join(","));
console.log(`\n${pass} passed, ${fail} failed`); if (fail) process.exit(1);
