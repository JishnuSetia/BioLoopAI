"""
BioLoop AI – AI explainer via local Ollama (Llama 3.2).
Calls Ollama API with match results, impact metrics, and scenario settings; returns human-readable explanation,
sustainability summary, and 3 strategic recommendations.
"""
import json
import os
import re
import sys

try:
    import requests
except ImportError:
    print(json.dumps({"error": "requests not installed. Run: pip install requests"}, indent=2), file=sys.stderr)
    sys.exit(1)

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")
MODEL = "llama3.2"
GENERATE_URL = f"{OLLAMA_HOST.rstrip('/')}/api/generate"


def build_prompt(matches: list, total_revenue: float, co2_saved: float, landfill_diverted: float,
                 total_transport_cost: float, scenario: dict = None) -> str:
    scenario_block = ""
    if scenario:
        scenario_block = f"\nScenario settings:\n{json.dumps(scenario, indent=2)}\n"
    return f"""You are an AI sustainability optimization expert.
Here are the optimized biomass matches:
{json.dumps(matches, indent=2)}

Impact metrics:
- Total revenue: {total_revenue} CAD
- Total transport cost: {total_transport_cost} CAD
- CO2 saved: {co2_saved} tCO2e
- Landfill diverted: {landfill_diverted} tonnes
{scenario_block}

Explain why these matches were selected in 2-3 short paragraphs.
Summarize economic and environmental benefits in one paragraph.
Then provide exactly 3 strategic recommendations (numbered 1, 2, 3) for the operator.
Keep the response concise and professional. Use JSON only if the instructions ask for it; otherwise use plain text."""


def call_ollama(prompt: str, max_tokens: int = 800) -> str:
    """Stream or single call to Ollama /api/generate. Returns full response text."""
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"num_predict": max_tokens},
    }
    try:
        r = requests.post(GENERATE_URL, json=payload, timeout=120)
        r.raise_for_status()
        data = r.json()
        return (data.get("response") or "").strip()
    except requests.exceptions.ConnectionError:
        return (
            "Ollama is not running or not reachable. Start it with: ollama serve && ollama run llama3.2. "
            "Explanation and recommendations are skipped."
        )
    except requests.exceptions.Timeout:
        return "Ollama request timed out. Explanation skipped."
    except Exception as e:
        return f"Ollama error: {str(e)}. Explanation skipped."


def parse_response(raw: str) -> dict:
    """
    Parse raw LLM response into explanation, sustainability_summary, recommendations.
    If parsing is not possible, return raw text in explanation and empty lists/summary.
    """
    explanation = raw
    sustainability_summary = ""
    recommendations = []

    # Heuristic: look for "recommendation" or "strategic" and numbered list
    lines = raw.split("\n")
    rec_start = -1
    for i, line in enumerate(lines):
        if "recommendation" in line.lower() or "strategic" in line.lower():
            rec_start = i
            break
        if line.strip().startswith("1.") or line.strip().startswith("1)"):
            rec_start = i
            break
    if rec_start >= 0:
        rec_block = "\n".join(lines[rec_start:])
        explanation = "\n".join(lines[:rec_start]).strip()
        # Extract 1. 2. 3. items
        for m in re.finditer(r"(?:^|\n)\s*[123][.)]\s*(.+?)(?=\n\s*[123][.)]|\n\n|\Z)", rec_block, re.S):
            recommendations.append(m.group(1).strip())
        if not recommendations:
            recommendations = [ln.strip() for ln in rec_block.split("\n") if ln.strip()][:3]
        sustainability_summary = explanation[:600] if len(explanation) > 600 else explanation
    else:
        # Use first paragraph as sustainability summary
        paras = [p.strip() for p in raw.split("\n\n") if p.strip()]
        if paras:
            sustainability_summary = paras[0][:500]

    return {
        "explanation": explanation or raw,
        "sustainability_summary": sustainability_summary or raw[:500],
        "recommendations": recommendations[:3] if recommendations else [],
    }


def main():
    """Read JSON from stdin: { matches, total_revenue, co2_saved, landfill_diverted, total_transport_cost, scenario? }."""
    try:
        payload = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}), file=sys.stderr)
        sys.exit(1)

    matches = payload.get("matches", [])
    total_revenue = payload.get("total_revenue", 0)
    co2_saved = payload.get("co2_saved", 0)
    landfill_diverted = payload.get("landfill_diverted", 0)
    total_transport_cost = payload.get("total_transport_cost", 0)
    scenario = payload.get("scenario")

    prompt = build_prompt(matches, total_revenue, co2_saved, landfill_diverted, total_transport_cost, scenario)
    raw = call_ollama(prompt)
    out = parse_response(raw)
    out["raw_response"] = raw
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
