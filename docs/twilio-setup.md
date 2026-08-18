# Twilio SMS setup

One-time setup so the scheduling agent can text work order links to
subcontractors from a Six Arrows number.

**Start this today even though the code is not finished.** Carriers review
every business that sends text messages in the US, and that review currently
takes 10 to 15 days. Nothing else in Tier 2 waits on it, so the registration
should be running in the background while the rest gets built. Everything works
by email in the meantime and switches to text the day the campaign is approved.

**Cost: a few dollars a month.** A phone number is about $1.15 a month, a text
is under a cent, and the one-time registration fees are around $20 all in. Six
Arrows will not send enough messages for the per-message cost to be visible.

At the end you will have three values to paste into Netlify:
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`.

---

## Before you start, have these to hand

Carrier registration asks for real business details and rejects
approximations. Gather them first:

- Legal business name exactly as it appears on the EIN paperwork
- EIN
- Business address
- A website URL (`sixarrowsconstruction.com`)
- Your name, email and mobile number as the point of contact

## 1. Create the account

1. Go to <https://www.twilio.com/try-twilio> and sign up with
   `cole@sixarrowsconstruction.com`
2. Verify the email and your mobile number
3. When it asks what you are building, answer **Alerts and Notifications**,
   **with code**, in **JavaScript**. None of these answers lock anything in
4. Upgrade the account (**Billing**, then **Upgrade**) and put about $20 on it.
   A trial account can only text numbers you have personally verified, which is
   useless here

## 2. Buy a number

1. **Phone Numbers**, then **Buy a number**
2. Filter to a **270** area code so it looks local to Bowling Green, and make
   sure **SMS** is ticked under Capabilities
3. Buy it. Write the number down in E.164 form, meaning `+12705551234`

This is the number your subs will see. It is worth telling them once that it is
Six Arrows, because the first text from an unknown number is the one people
ignore.

## 3. Register the brand and campaign (the part that takes days)

This is A2P 10DLC registration. Carriers block unregistered business texting
outright, so this is not optional and it is not fast.

1. **Messaging**, then **Regulatory Compliance**, then **A2P 10DLC**
2. Register a **Standard** brand, not Sole Proprietor. Six Arrows has an EIN,
   and a standard brand gets better delivery and higher throughput
3. Enter the business details from the top of this page. The legal name and EIN
   have to match the IRS record exactly or the brand fails vetting and you pay
   the fee again
4. Create a **campaign**. Use case: **Mixed** or **Customer Care**, either is
   fine for this
5. Campaign details, which you can paste more or less as-is:

   **What the messages are about:**

   > Six Arrows Construction sends scheduling messages to subcontractors we have
   > hired: a link to a work order with the scope and dates for their work, and
   > reminders when we have not heard back.

   **How recipients consent:**

   > Subcontractors give us their mobile number when they begin working with us
   > and are told we use it to send scheduling and work order messages. We only
   > message subcontractors we have an existing working relationship with. We do
   > not message consumers and we do not send marketing.

   **Sample messages:** use two real ones, for example

   > Six Arrows Construction: work order for underslab plumbing at 106 Reynolds
   > Ln, starting 8/24. Scope, dates and payment terms here:
   > https://sparkly-baklava-bb8c92.netlify.app/work-order.html?t=ab12cd34
   > Reply STOP to opt out.

   > Six Arrows Construction: following up on the work order for underslab
   > plumbing. Let us know your dates when you get a chance:
   > https://sparkly-baklava-bb8c92.netlify.app/work-order.html?t=ab12cd34

6. Submit and wait. Twilio emails when the campaign is approved

While it is pending, sending will fail with error **30034**, "message from an
unregistered number". That is expected and it is not a bug in the portal.

## 4. Give the portal the credentials

1. **Account Dashboard** in Twilio, copy the **Account SID** and the
   **Auth Token**
2. In Netlify: **Site configuration**, then **Environment variables**, add

   | Key | Value |
   |---|---|
   | `TWILIO_ACCOUNT_SID` | starts with `AC` |
   | `TWILIO_AUTH_TOKEN` | the auth token |
   | `TWILIO_FROM_NUMBER` | your new number, `+1270...` |

3. **Deploys**, then **Trigger deploy**, so the functions pick them up

## 5. Check it

    https://YOUR_DOMAIN/.netlify/functions/work-order-send?diag=1

It reports whether the credentials are set, whether Twilio accepts them, and
what the account and the number look like from Twilio's side. It sends nothing.

To send one real text to your own phone:

    https://YOUR_DOMAIN/.netlify/functions/work-order-send?diag=1&testTo=%2B12705551234

---

## Rules the code already follows, so you do not have to think about them

- **Every message identifies Six Arrows.** Carriers require it and it is why a
  sub reads the text instead of deleting it.
- **The first message to any number carries opt-out wording.** Twilio handles a
  STOP reply itself and will refuse to message that number again.
- **Nothing sends without you approving it.** Twilio is the transport. The
  decision is still yours on every single message, including the follow-ups.
- **No message goes to a subcontractor before 8am or after 6pm their time.**
  Quiet hours are a carrier rule and also basic manners.

## If it stops working

- **30034, unregistered number:** the campaign is not approved yet, or the
  number was never attached to it. Twilio's A2P page shows which
- **21610, unsubscribed recipient:** that sub replied STOP at some point. They
  have to text START to that number themselves. Nobody can undo it from this end
- **20003, authenticate:** the auth token was rotated. Paste the new one into
  Netlify and redeploy
- **21211, invalid To number:** the number on the Notion subcontractor row is
  not a real mobile in E.164 form. The send endpoint reports which sub

## Sources

- <https://www.twilio.com/docs/messaging/compliance/a2p-10dlc>
- <https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart>
