"""
BioLoop AI – Match review assistant via local Ollama (Llama 3.2).
Evaluates a single farm-industry match and returns a JSON recommendation:
decision (ACCEPT/CONSIDER/DECLINE), confidence, summary, key_factors, risks, improvements.
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


def safe_float(value, default=0.0):
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def heuristic_review(match: dict) -> dict:
    revenue = safe_float(match.get("revenue"))
    transport = safe_float(match.get("transport_cost"))
    co2_saved = safe_float(match.get("co2_saved"))
    distance = safe_float(match.get("distance_km"))
    sustainability = safe_float(match.get("sustainability_score"))
    net_value = revenue - transport

    score = 0
    if net_value > 3000:
        score += 2
    elif net_value > 0:
        score += 1
    else:
        score -= 1

    if distance < 80:
        score += 1
    elif distance > 200:
        score -= 1

    if sustainability >= 0.6:
        score += 1
    elif sustainability < 0.4:
        score -= 1

    if co2_saved > 5:
        score += 1

    if score >= 3:
        decision = "ACCEPT"
    elif score >= 1:
        decision = "CONSIDER"
    else:
        decision = "DECLINE"

    confidence = max(0.45, min(0.9, 0.55 + score * 0.1))
    summary = f"{decision.title()} based on net value, distance, and sustainability impact."
    key_factors = [
        f"Net value: {net_value:.0f} CAD",
        f"Distance: {distance:.0f} km",
        f"CO2 saved: {co2_saved:.2f} tCO2e",
    ]
    risks = []
    if net_value <= 0:
        risks.append("Negative net value after transport cost.")
    if distance > 200:
        risks.append("Long transport distance increases cost and operational risk.")
    if sustainability < 0.4:
        risks.append("Low sustainability score vs. other options.")
    if not risks:
        risks.append("No major red flags detected based on current data.")
    improvements = [
        "Negotiate transport cost sharing or closer pickup points.",
        "Confirm biomass quality and consistency before contracting.",
        "Lock in volumes to improve revenue certainty.",
    ]
    return {
        "decision": decision,
        "confidence": round(confidence, 2),
        "summary": summary,
        "key_factors": key_factors,
        "risks": risks,
        "improvements": improvements,
    }


def build_prompt(match: dict, farm: dict, industry: dict, net_value: float) -> str:
    return f"""You are an AI advisor for biomass collaboration contracts.
Evaluate the following match and decide whether to ACCEPT, CONSIDER, or DECLINE.
Return ONLY valid JSON with keys:
decision (ACCEPT/CONSIDER/DECLINE), confidence (0-1), summary, key_factors (array),
risks (array), improvements (array).

Match metrics:
{json.dumps(match, indent=2)}
Net value (revenue - transport): {net_value:.2f} CAD

Farm profile:
{json.dumps(farm or {}, indent=2)}

Industry profile:
{json.dumps(industry or {}, indent=2)}
"""


def call_ollama(prompt: str, max_tokens: int = 600) -> str:
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
        return ""
    except requests.exceptions.Timeout:
        return ""
    except Exception:
        return ""


def extract_json(raw: str):
    if not raw:
        return None
    match = re.search(r"\{.*\}", raw, re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except Exception:
        return None


def normalize_review(review: dict, fallback: dict) -> dict:
    if not isinstance(review, dict):
        return fallback
    decision = str(review.get("decision", "")).strip().upper()
    if decision not in {"ACCEPT", "CONSIDER", "DECLINE"}:
        decision = fallback["decision"]
    confidence = safe_float(review.get("confidence"), fallback.get("confidence", 0.6))
    confidence = max(0.0, min(1.0, confidence))
    return {
        "decision": decision,
        "confidence": round(confidence, 2),
        "summary": str(review.get("summary") or fallback.get("summary") or ""),
        "key_factors": review.get("key_factors") or fallback.get("key_factors") or [],
        "risks": review.get("risks") or fallback.get("risks") or [],
        "improvements": review.get("improvements") or fallback.get("improvements") or [],
    }


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}), file=sys.stderr)
        sys.exit(1)

    match = payload.get("match") or {}
    farm = payload.get("farm") or {}
    industry = payload.get("industry") or {}

    net_value = safe_float(match.get("revenue")) - safe_float(match.get("transport_cost"))
    fallback = heuristic_review(match)
    prompt = build_prompt(match, farm, industry, net_value)
    raw = call_ollama(prompt)
    review = extract_json(raw)
    out = normalize_review(review, fallback)
    out["raw_response"] = raw
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
