// Vercel serverless entry point. Vercel imports this file and invokes the
// exported Express app; it manages listening itself, so the app must not bind
// a port here (src/index.ts skips app.listen when VERCEL is set).
export { default } from "../src/index.js";
