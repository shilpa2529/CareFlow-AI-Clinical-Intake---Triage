import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './index';

// Serve static frontend files from ./public
app.use('/*', serveStatic({ root: './public' }));

const port = Number(process.env.PORT) || 8787;

const server = serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    const isDemo = !process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes('your_key_here');
    console.log(`\n=============================================================`);
    console.log(`  CareFlow AI Server is LIVE!`);
    console.log(`  URL:               http://localhost:${info.port}`);
    console.log(`  AI Engine Mode:    ${isDemo ? 'DEMO MODE (Synthetic Engine Active)' : 'LIVE Claude API Connected'}`);
    console.log(`=============================================================\n`);
    console.log(`  Open in browser:   http://localhost:${info.port}`);
    console.log(`  Clinician Queue:   http://localhost:${info.port}/dashboard.html`);
    console.log(`  Prompt Lab:        http://localhost:${info.port}/lab.html`);
    console.log(`  Evaluation Harness:http://localhost:${info.port}/eval.html\n`);
  }
);

server.on('error', (err: any) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[PORT IN USE] Port ${port} is already being used by another application.`);
    console.error(`To run on another port, set the PORT environment variable:`);
    console.error(`  PowerShell: $env:PORT=8788; npm run dev`);
    console.error(`  CMD:        set PORT=8788 && npm run dev\n`);
    process.exit(1);
  } else {
    throw err;
  }
});
