"""Compare two k6 summary exports and fail if the pull request got slower.

Usage:
  python scripts/compare.py results/main.json results/pr.json
  python scripts/compare.py results/main.json results/pr.json --tolerance 25 --min-delta-ms 10

An endpoint counts as a regression when BOTH are true:
  * its p95 is more than --tolerance percent slower than main, and
  * it is at least --min-delta-ms slower (so 8ms -> 13ms, "+60%", is ignored as noise)

Writes a Markdown table to stdout, and to the GitHub job summary when running in Actions.
Exit code: 0 = no regression, 1 = regression found.
"""
import argparse
import json
import os
import sys

PREFIX = "http_req_duration{name:"


def load_p95(path: str) -> dict[str, dict]:
    """Return {endpoint: {"p95": ms, "slo_failed": bool}} for every tagged endpoint."""
    with open(path) as f:
        metrics = json.load(f)["metrics"]
    out = {}
    for key, values in metrics.items():
        if key.startswith(PREFIX):
            endpoint = key[len(PREFIX):-1]
            # Careful: in --summary-export, a threshold value of `true` means it FAILED.
            slo_failed = any(values.get("thresholds", {}).values())
            out[endpoint] = {"p95": values["p(95)"], "slo_failed": slo_failed}
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("baseline")
    parser.add_argument("candidate")
    parser.add_argument("--tolerance", type=float, default=float(os.getenv("PERF_TOLERANCE", 25)))
    parser.add_argument("--min-delta-ms", type=float, default=float(os.getenv("PERF_MIN_DELTA_MS", 10)))
    args = parser.parse_args()

    base = load_p95(args.baseline)
    cand = load_p95(args.candidate)

    lines = [
        "### k6: this PR vs main (p95)",
        "",
        f"Fails when an endpoint is more than **{args.tolerance:g}%** and **{args.min_delta_ms:g}ms** slower than main.",
        "",
        "| Endpoint | main | this PR | change | result |",
        "| --- | ---: | ---: | ---: | --- |",
    ]
    regressions = []
    for endpoint in sorted(cand):
        new = cand[endpoint]["p95"]
        if endpoint not in base:
            lines.append(f"| `{endpoint}` | n/a | {new:.1f}ms | new | ✓ |")
            continue
        old = base[endpoint]["p95"]
        change = (new - old) / old * 100
        slower = change > args.tolerance and (new - old) >= args.min_delta_ms
        if slower:
            regressions.append(endpoint)
        result = "✗ slower than main" if slower else "✓"
        if cand[endpoint]["slo_failed"]:
            result += " · ✗ SLO threshold failed"
        lines.append(f"| `{endpoint}` | {old:.1f}ms | {new:.1f}ms | {change:+.0f}% | {result} |")

    lines.append("")
    if regressions:
        lines.append(f"**✗ FAIL:** {len(regressions)} endpoint(s) regressed: " + ", ".join(f"`{e}`" for e in regressions))
    else:
        lines.append("**✓ PASS:** no endpoint regressed beyond the tolerance.")
    report = "\n".join(lines)

    print(report)
    summary_file = os.getenv("GITHUB_STEP_SUMMARY")
    if summary_file:
        with open(summary_file, "a") as f:
            f.write(report + "\n")
    with open(os.path.join(os.path.dirname(os.path.abspath(args.candidate)), "report.md"), "w") as f:
        f.write(report + "\n")

    return 1 if regressions else 0


if __name__ == "__main__":
    sys.exit(main())
