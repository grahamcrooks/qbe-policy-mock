# QBE training mock: Guidewire PolicyCenter and Duck Creek Policy

Mock policy-system APIs that a Pega application (built from the Global Commercial Underwriting Blueprint) can call over REST.
Illustrative only: paths and payloads are simplified and are **not** the vendors' official APIs.

## Deploy (about 10 minutes, free)

1. Create a new GitHub repository and upload these files: `server.js`, `package.json`, `openapi.yaml`, `render.yaml`, `.gitignore`, `README.md`.
2. Sign in to https://render.com with GitHub. Choose **New → Blueprint**, pick the repository, and click **Apply**. (Or **New → Web Service**: build `npm install`, start `npm start`.)
3. When it shows **Live**, note your URL, e.g. `https://qbe-policy-mock.onrender.com`.
4. Test: open `https://YOUR-APP.onrender.com/health` in a browser. You should see `{"status":"ok"}`.

To change the API key, set the `API_KEY` environment variable in Render (default `qbe-demo`).

## Base URLs for the Blueprint

| System | Base URL |
|---|---|
| Guidewire (mock) | `https://YOUR-APP.onrender.com/guidewire/pc/rest` |
| Duck Creek (mock) | `https://YOUR-APP.onrender.com/duckcreek/policy/api/v1` |

Every call needs the header `X-API-Key: qbe-demo` (except `/`, `/health`, `/openapi.yaml`).
The OpenAPI spec is at `https://YOUR-APP.onrender.com/openapi.yaml` for Pega's REST integration wizard.

## Guidewire resources

| Blueprint data object | Method | Resource |
|---|---|---|
| Submission | POST | `/job/v1/submissions` |
| Coverage Request (quote) | POST | `/job/v1/submissions/{submissionId}/quote` |
| Customer Decision (bind) | POST | `/job/v1/submissions/{submissionId}/bind` — body `{"pegaDecisionId":"..."}` |
| Policy | GET | `/policy/v1/policies/{policyNumber}` |
| Policy (search) | GET | `/policy/v1/policies?accountNumber=...` |
| Loss History | GET | `/policy/v1/policies/{policyNumber}/claims` |

## Duck Creek resources

| Blueprint data object | Method | Resource |
|---|---|---|
| Submission | POST | `/quotes` |
| Coverage Request (rate) | POST | `/quotes/{quoteId}/rate` |
| Customer Decision (issue) | POST | `/quotes/{quoteId}/issue` — body `{"approvedDecisionRef":"..."}` |
| Policy | GET | `/policies/{policyId}` |
| Policy (search) | GET | `/policies?insuredId=...` |
| Loss History | GET | `/policies/{policyId}/claims` |

## Seeded demo data

| System | ID | Description |
|---|---|---|
| Guidewire | `GW-POL-100001` (account `ACC-SYD-001`) | Sydney office tower, A$1.2bn, terrorism, 15% lead, ARPC, one closed claim |
| Duck Creek | `DC-POL-200001` (insured `INS-LON-001`) | London office, £900m, terrorism, 10% follow, Pool Re, one open denial-of-access claim |

## Behaviours worth showing

- **One front door:** bind/issue is rejected (403 `APPROVED_DECISION_REQUIRED`) unless Pega sends its approved decision ID.
- **Order of operations:** quote/rate before bind/issue (422 otherwise); a second bind returns 409.
- **Idempotency:** send header `Idempotency-Key`; repeating the same bind returns the same policy, not a second one.
- **Error drills:** header `X-Mock-Scenario: validation` (422), `unavailable` (503) or `timeout` (waits 30 s, then 504).
- **Different shapes:** Guidewire and Duck Creek return different field names, so the Pega mapping does real translation.

## Example calls

```bash
B=https://YOUR-APP.onrender.com
curl -H "X-API-Key: qbe-demo" $B/guidewire/pc/rest/policy/v1/policies/GW-POL-100001

curl -X POST -H "X-API-Key: qbe-demo" -H "Content-Type: application/json" \
  -d '{"pegaCaseId":"UW-1001","insured":{"name":"Harbour Tower Holdings Pty Ltd"},"product":"TerrorismSabotage","jurisdiction":"AU","sumInsured":{"amount":1200000000,"currency":"AUD"},"sharePercent":15,"role":"Lead"}' \
  $B/guidewire/pc/rest/job/v1/submissions
```

## Notes for the training session

- **Free tier sleeps** after about 15 minutes idle; the first call then takes up to a minute. Open `/health` a few minutes before students start.
- **Data is in memory** and resets when the service restarts. Seeded policies always come back.
- **Shared by all students.** Ask each student to use their own `pegaCaseId` / `externalReference` so their records are easy to find.
- Pega side: create a REST connector (or use the integration wizard with `openapi.yaml`), add `X-API-Key` as a request header, and map responses into the Policy, Coverage Request, Customer Decision and Loss History data objects. Specialise the data source by division to call Guidewire for Australia Pacific and Duck Creek for International.
