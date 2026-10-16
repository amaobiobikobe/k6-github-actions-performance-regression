# k6 in GitHub Actions: fail slow pull requests

Companion code for the video **"How Do You Run k6 in GitHub Actions and Fail Slow Pull Requests?"** on [@buildwithamaobi](https://www.youtube.com/@buildwithamaobi).

It's the same FastAPI app from episode 1 ([video](https://www.youtube.com/watch?v=WIntbYKzASk), [repo](https://github.com/victorex27/k6-load-test-api-with-login)), plus a GitHub Actions workflow that runs k6 on every pull request and fails the check in two cases:

1. **An absolute threshold breaks** (your SLO, for example `GET /items` p95 < 300ms). k6 exits with code `99`.
2. **The PR is slower than `main`**, even if it's still under the SLO. `scripts/compare.py` exits with code `1`.

No Grafana Cloud account needed.

## How it works

```
pull request opened
  └─ one job, one runner
       ├─ check out main  ─┐
       ├─ check out PR    ─┤  same k6 script, same seed data
       ├─ k6 on main      ─┤→ results/main.json
       ├─ k6 on PR        ─┘→ results/pr.json      (fails here if an SLO breaks)
       ├─ compare.py main.json pr.json            (fails here if the PR is slower)
       └─ table in the job summary + a PR comment
```

Why main and the PR run in the same job: GitHub-hosted runners differ from run to run. Comparing today's PR with a baseline saved last week on another machine gives false alarms. Back to back on one machine, the noise mostly cancels out.

An endpoint only counts as slower when it's **more than 25% slower AND at least 10ms slower** (both configurable). The second rule stops 8ms → 13ms ("+60%") from failing your build.

## Files

| Path | What it is |
| --- | --- |
| `.github/workflows/performance.yml` | The workflow |
| `k6/ci-perf.js` | The k6 test that runs in CI (10 VUs, 45s, per-endpoint thresholds) |
| `scripts/run-perf.sh` | Seeds the DB, starts the API, runs k6, stops the API, returns k6's exit code |
| `scripts/seed.py` | Fills the DB with background data (an empty DB hides slow queries) |
| `scripts/compare.py` | Compares two k6 summaries, prints a Markdown table, exits 1 on a regression |
| `k6/01-smoke.js`, `02-user-journey.js`, `03-load-test.js` | The scripts from episode 1 |
| `app/` | The API: signup, login (JWT), users, items |

## Use it in your own repo

1. Copy `.github/workflows/performance.yml`, `scripts/` and your k6 test.
2. Change the "start the API" part of `scripts/run-perf.sh` for your stack (or use `docker compose up -d`).
3. Tag every request you care about (`tags: { name: 'GET /items' }`) and give each tag a threshold. Without a threshold, k6 doesn't report that endpoint separately, and `compare.py` can't see it.
4. Make it block merges: **Settings → Rules → Rulesets → Require status checks to pass**, and add the `k6` check.

## Run it on your machine

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# install k6 v2: https://grafana.com/docs/k6/latest/set-up/install-k6/
brew install k6                    # macOS
winget install k6 --source winget  # Windows
k6 version

# One run: seed, start the API, run the CI test
scripts/run-perf.sh . results/main.json

# Compare two runs
python scripts/compare.py results/main.json results/pr.json
```

`scripts/run-perf.sh` needs bash and curl (macOS, Linux, WSL or Git Bash on Windows).

Run only the API, like in episode 1:

```bash
fastapi run app/main.py            # http://localhost:8000/docs
```

## Settings

| Variable | Default | Where |
| --- | --- | --- |
| `PERF_TOLERANCE` | `25` (%) | workflow `env`, read by `compare.py` |
| `PERF_MIN_DELTA_MS` | `10` | workflow `env`, read by `compare.py` |
| `SEED_USERS` / `SEED_ITEMS` | `2000` / `100` in CI | workflow `env`, read by `run-perf.sh` |
| `K6_VERSION` | `2.3.0` | workflow `env` |
| `DATABASE_URL` | `sqlite:///./app.db` | API |
| `SECRET_KEY` | dev value | API. **Change it in any real deployment** |
| `BCRYPT_ROUNDS` | `10` | API |

API reference: [docs/API.md](docs/API.md). Postman collection: `postman/`.

> Only load test systems you own or have permission to test.
