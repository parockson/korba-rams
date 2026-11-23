// npm run migrate  - applies migrations and seeds against NETLIFY_DATABASE_URL
import { ensureReady } from "./bootstrap";
ensureReady()
  .then(() => console.log("RAMS database is up to date."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
