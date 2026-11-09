# Setup

Requirements: **Node 20+** and git. Nothing else to install; the database is a
SQLite file created on your machine.

## From scratch

```sh
git clone https://github.com/LisHdzG/recruiting-challenge.git
cd recruiting-challenge
git checkout lisette/challenge
npm install
npm run seed
npm run dev
```

1. `npm run seed` creates `data/dashboard.db` with two merchants (`m_acme`,
   `m_bistro`) and 80 orders, and prints one API key per merchant. **Copy the
   keys**: only their hash is stored, so they are shown once.
2. Open <http://localhost:3000> and paste one of the keys at the top of the page.
3. `npm test` runs the test suite. It uses an in-memory database and does not
   touch `data/`.

## If you already had the project

**1. Update the code.**

```sh
git fetch origin
git checkout lisette/challenge
git pull
npm install
```

If git refuses because of local changes or reports conflicts:

- You don't need your changes: `git reset --hard origin/lisette/challenge`
- You want to keep them: `git stash`, run the commands above, then `git stash pop`
- The conflict is in `package-lock.json`: `git checkout origin/lisette/challenge -- package-lock.json`, then `npm install`

**2. Update the database.** `data/dashboard.db` is not in git, so yours stays
as it was and may be from an older version. Pick one:

- **Start over (simplest):** delete `data/dashboard.db`, `data/dashboard.db-shm`
  and `data/dashboard.db-wal`, then `npm run seed`. You get new data and new keys.
- **Keep your data:** `npm run migrate`. It is safe to run more than once. It
  prints an API key for every merchant that had none; copy them.

Then `npm run dev`.

## Common problems

| Problem | Fix |
|---|---|
| Server exits with `This database needs a migration` | `npm run migrate`, then start again. |
| Server prints `No merchants yet` | `npm run seed`. |
| `401 unauthorized` in the dashboard, or you lost the API keys | Keys cannot be recovered. Delete the three `data/dashboard.db*` files and run `npm run seed`. |
| `npm run seed` prints `no new merchants, so no API keys were issued` | The database already has data. Delete the three `data/dashboard.db*` files and seed again. |
| `EADDRINUSE` (port 3000 is taken) | `PORT=3055 npm run dev` |
| `better-sqlite3` fails with `NODE_MODULE_VERSION` or `Could not locate the bindings file`, or `esbuild` says it was installed for another platform | `node_modules` was installed with another Node version or copied from another machine. Delete `node_modules` and run `npm install`. |
| `npm install` fails building `better-sqlite3` on Windows | Install the Visual Studio build tools, then `npm install` again. |
| Dashboard asks for the key again | The key is kept for the open tab only. Paste it again. |
