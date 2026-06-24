# 🏠 Wholesale CRM

A custom CRM for real estate wholesaling — track leads through your pipeline, log every
call/note, build a cash-buyer list, and email sellers right from each lead. Runs locally
on your Mac; your data lives in a single `crm.db` file you fully own.

## What it does

- **Lead pipeline** — New → Contacted → Follow-Up → Offer Made → Under Contract → Assigned → Closed / Dead
- **Deal numbers** with an automatic **MAO calculator** (70% / 75% of ARV − repairs − fee)
- **Activity timeline** per lead — notes, calls, stage changes, and sent emails all logged
- **Email sellers** through your Gmail, logged to the lead automatically
- **Cash buyer list** — areas, property types, max price
- **Dashboard** — active leads, pipeline value, and follow-ups due today / overdue

## First-time setup

```bash
cd ~/wholesale-crm
npm install
npm start
```

Then open **http://localhost:4000** in your browser.

That's it — lead tracking, the pipeline, buyers, and the dashboard all work immediately.

## Turning on email (Gmail) — no terminal needed

1. Open the **Outreach** tab and click **Connect Gmail**.
2. Enter your Gmail address and a **Google App Password**
   (create one at https://myaccount.google.com/apppasswords — requires 2-Step Verification on).
   Optionally add a "From name", and your name/phone for the `{{my_name}}` / `{{my_phone}}` merge fields.
3. Click **Save connection**, then **Send test to myself** to confirm it works.

Now the **📧 Email** button on any lead — and the bulk **Outreach** sender — send through your Gmail
and log every send to the lead's timeline.

> Prefer the terminal? You can still put `GMAIL_USER` / `GMAIL_APP_PASSWORD` in a `.env` file
> (see `.env.example`); in-app settings take priority if both are set.

## Outreach & templates

The **Outreach** tab lets you:
- Manage reusable **email templates** with merge fields: `{{first_name}}`, `{{address}}`, `{{city}}`,
  `{{my_name}}`, `{{my_phone}}`, `{{arv}}`, `{{repair_estimate}}`, `{{contract_price}}`, and more.
- **Send a template to many recipients at once** — pick Leads (filtered by stage) or your Buyers list,
  check who to include, and each email is personalized per recipient and logged to that lead.
- Three starter templates are included (cold seller, follow-up, buyer blast).

**Gmail sending limits:** a normal Gmail account allows roughly 500 emails/day. For real cold-email
volume you'd eventually want a dedicated sending domain/service — ask when you get there.

## Daily use

- Click **+ New Lead** to add a property/seller.
- Open a lead to edit numbers, log calls, set a **next follow-up** date, or email the seller.
- Check the **Dashboard** each morning for what's due.

## Your data

Everything is stored in `crm.db` in this folder. Back it up by copying that one file.
`.env`, `crm.db`, and `node_modules/` are gitignored so nothing private gets committed.

## Hosting it later (phone access)

This is a standard Node/Express app, so it deploys as-is to Render, Railway, or Fly.io
when you're ready to use it from your phone. Just set the same env vars there. Ask and
I'll walk you through it.
