// Copied into the e2e app by e2e/addToApp.ts: runs locked child scripts on
// the deployed platform and reports what they could and couldn't do. See
// e2e/checks.ts
import { runLockedChildChecks } from 'src/lib/lockedChildChecks'

export async function handleRequest(_request: Request) {
  return new Response(JSON.stringify(await runLockedChildChecks()), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
