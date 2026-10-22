# Hanamoto Workshop (standalone)

Real logins for each person, a proper database, file storage and the drawing reader, on Hanamoto's own web address.
No Claude plan is needed to share it. Anyone you give an account to just opens the link and signs in.

## What is already set up
- **Supabase project** `hanamoto-workshop`: tables, security rules, live updates, file storage, and two server functions (`admin-user`, `estimate`).
- **Netlify site** `hanamoto-workshop` (address: https://hanamoto-workshop.netlify.app), open to the public so staff can reach the sign-in page.

## What is left for you
1. **Deploy the website files.** In Netlify, open the site `hanamoto-workshop`, go to **Deploys**, and drag the contents of the `public` folder (or `hanamoto-site.zip`) onto the page where it says to drag and drop.
2. **Create your owner login.** In Supabase: **Authentication > Users > Add user > Create new user**, type your email and a password, tick **Auto Confirm User**. Then tell Claude your email, and it will make that account the owner.
3. **(Optional) Turn on the drawing reader.** In Supabase: **Edge Functions > Secrets**, add a secret named `ANTHROPIC_API_KEY` with your key from console.anthropic.com. Without it the app works, but the estimator says it is switched off.
4. Open https://hanamoto-workshop.netlify.app, sign in, go to **People** and create accounts for Jeff, Walter, the directors and clients. The app shows a temporary password and a ready-made WhatsApp message for each. They choose their own password at first sign-in.

## Alerts and payments
- **Alerts.** When a step is waiting for someone (an approval, a payment to confirm, a delivery to create), the people who hold that position get an alert in the app (the 🔔) and, if they have turned it on, on their phone. Each person taps ⚙ then "Turn on alerts on this phone". On an iPhone, first add the app to the Home Screen (Share, then Add to Home Screen) and open it from there.
- **Payments.** Jeff sets, per job, the **contract value (KES)** and the **deposit %** (the balance is the rest). The deposit and balance steps then show the percentage and the amount, directors approve each payment, and the dashboard totals the money received and still to come.

## Materials, stock and room checks
- **Materials.** After the deposit is confirmed, Jeff sends a materials list (pre-filled from the estimate) to **Procurement**. Procurement approves it, orders, pays and receives. A **director** must approve a payment only when it is above the **spending limit** (set on the directors' Dashboard; if no limit is set, directors approve every payment). Receiving books the materials into stock and moves the job into production.
- **Storekeeper.** Keeps the stock list with a full history of every item received and issued, and a **restock level** for each item. Jeff and the supervisor request materials for a job; the storekeeper issues them. When stock reaches its restock level the storekeeper is alerted and can send a restock request to Procurement.
- **Crew and team leaders.** The supervisor can give crew members their own logins. When assigning people to an item, tap the star to make one the **team leader**. At the end of Room 1 and Room 2 the team leader checks the work, then the supervisor confirms before it moves on. With no team leader, the supervisor confirms directly.

## Who can do what
- **Owner and directors:** everything, including creating and removing any account and removing jobs.
- **Jeff:** jobs, estimates, deliveries, and creating Walter, clients and room screens.
- **Walter:** the floor board, crew and deliveries.
- **Clients:** only their own job.
- **Procurement:** approves, orders, pays for and receives materials.
- **Storekeeper:** stock, issuing materials and restock requests.
- **Crew:** their own tasks, and team leaders check room work.
- **Room screens:** read only, one room each.
These rules are enforced by the database, not just hidden in the screen.

## Added 22 Oct 2026
- **Express jobs (Jeff adds, a director approves):** an approved express job goes straight to production. Other jobs and their timers freeze, then resume with the exact time left. Express jobs stack first in, first out. Approval skips stages 1 to 7. Job due dates are not shifted by pauses.
- **Delivery vehicles (Jeff):** a vehicle list with an outside-hire option, a planned delivery date, a reminder card about 2 days before, and a vehicle and driver note on each delivery. The reminder shows in the app, not as a scheduled phone push.
- **Stock categories (storekeeper):** Metal, Carpentry, Machines, Paints, Doors and windows, Sanitary ware, Cement, Accessories, plus new ones. Category tiles open into an inventory with material, size, opening stock, in, out and an automatic balance. Items not yet sorted show under "Not sorted yet".
- **Stock removal:** the storekeeper requests, Procurement confirms (soft delete, history kept).
- **Procurement:** a Documents tab (internal, hidden from clients and Walter) and a purchase price history filled from prices entered when an order is placed.

## Honest limits of this first version
- Uploaded files use a public bucket with long unguessable links. Anyone handed a link can open that file. Private links are the next security step.
- A client can read and change only their own job's rows, but the database does not yet stop them changing fields they should not (for example the step number). Field-level protection is the next step.
- Free Supabase projects may pause when unused and do not include automatic daily backups. Keep using **Back up all data** until you upgrade.
- Tested against a simulated database and against the live schema checks, but not yet clicked through on the live site, so expect a short round of fixes.
