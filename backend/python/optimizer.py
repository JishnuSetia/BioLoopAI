"""
BioLoop AI – Optimization module (PuLP).
Maximizes: revenue - transport_cost + carbon_value (scaled by simulation preferences).
Constraints: supply <= farm quantity, demand <= industry quantity, compatible biomass types, distances via Haversine.
Outputs: list of matches with quantity_matched, distance_km, transport_cost, revenue, sustainability_score.
Supports two-way flows: FARM_TO_INDUSTRY and INDUSTRY_TO_FARM.
"""
import json
import sys
from haversine import haversine_km

try:
    from pulp import LpMaximize, LpProblem, LpVariable, lpSum, LpStatus, PULP_CBC_CMD
except ImportError:
    print(json.dumps({"error": "PuLP not installed. Run: pip install pulp"}, indent=2), file=sys.stderr)
    sys.exit(1)

# Economic parameters (tunable defaults)
REVENUE_PER_TONNE = 80.0   # CAD per tonne (default)
COST_PER_KM_TONNE = 0.25   # CAD per km per tonne
CO2_SAVED_PER_TONNE = 0.12 # tCO2e per tonne diverted from landfill
CARBON_VALUE_PER_TCO2 = 30 # CAD value per tCO2e saved (optional incentive)


def safe_float(value, default):
    """Parse float with fallback."""
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def clamp(value, low, high):
    """Clamp a number into [low, high]."""
    return max(low, min(high, value))


def parse_allocation_mode(mode):
    """Normalize allocation preference into: distance, balanced, revenue."""
    if isinstance(mode, (int, float)):
        if int(mode) == 0:
            return "distance"
        if int(mode) == 2:
            return "revenue"
        return "balanced"
    m = str(mode or "").strip().lower()
    if m in {"distance", "minimize_distance", "minimize-distance", "minimize"}:
        return "distance"
    if m in {"revenue", "maximize_revenue", "maximize-revenue", "max"}:
        return "revenue"
    return "balanced"


def allocation_weights(mode):
    """Return (revenue_weight, transport_weight) based on allocation preference."""
    if mode == "distance":
        return 0.85, 1.25
    if mode == "revenue":
        return 1.2, 0.8
    return 1.0, 1.0


def is_compatible(waste_type: str, required_type: str) -> bool:
    """Biomass compatibility: exact match or allow common aliases."""
    w = (waste_type or "").strip().lower()
    r = (required_type or "").strip().lower()
    if w == r:
        return True
    # Allow common mappings
    aliases = {
        "manure": ["manure", "biogas feedstock", "organic fertilizer"],
        "crop residue": ["crop residue", "crop_residue", "biomass pellets", "pellets"],
        "straw": ["straw", "biogas feedstock", "biomass pellets", "pellets"],
    }
    for key, vals in aliases.items():
        if w in vals or w == key:
            if r in vals or r == key:
                return True
        if r in vals or r == key:
            if w in vals or w == key:
                return True
    return False


def build_simulation_config(payload: dict) -> dict:
    """Extract and normalize simulation settings."""
    sim = payload.get("simulation") or {}
    transport_mult = clamp(safe_float(sim.get("transport_cost_multiplier"), 1.0), 0.1, 5.0)
    supply_mult = clamp(safe_float(sim.get("supply_multiplier"), 1.0), 0.1, 5.0)
    demand_mult = clamp(safe_float(sim.get("demand_multiplier"), 1.0), 0.1, 5.0)
    allocation_mode = parse_allocation_mode(sim.get("allocation_mode", "balanced"))

    revenue_per_tonne = safe_float(sim.get("revenue_per_tonne"), REVENUE_PER_TONNE)
    cost_per_km_tonne = safe_float(sim.get("cost_per_km_tonne"), COST_PER_KM_TONNE)
    co2_saved_per_tonne = safe_float(sim.get("co2_saved_per_tonne"), CO2_SAVED_PER_TONNE)
    carbon_value_per_tco2 = safe_float(sim.get("carbon_value_per_tco2"), CARBON_VALUE_PER_TCO2)

    return {
        "transport_cost_multiplier": transport_mult,
        "supply_multiplier": supply_mult,
        "demand_multiplier": demand_mult,
        "allocation_mode": allocation_mode,
        "revenue_per_tonne": revenue_per_tonne,
        "cost_per_km_tonne": cost_per_km_tonne,
        "co2_saved_per_tonne": co2_saved_per_tonne,
        "carbon_value_per_tco2": carbon_value_per_tco2,
    }


def run_optimization(farms: list, industries: list, simulation: dict) -> dict:
    """
    Run PuLP optimization. Each farm and industry is a dict with:
    id, name, waste_type/required_type, quantity/quantity_needed, latitude, longitude.
    """
    sim = simulation or {}
    transport_mult = sim["transport_cost_multiplier"]
    supply_mult = sim["supply_multiplier"]
    demand_mult = sim["demand_multiplier"]
    allocation_mode = sim["allocation_mode"]
    revenue_per_tonne = sim["revenue_per_tonne"]
    cost_per_km_tonne = sim["cost_per_km_tonne"] * transport_mult
    co2_saved_per_tonne = sim["co2_saved_per_tonne"]
    carbon_value_per_tco2 = sim["carbon_value_per_tco2"]
    revenue_weight, transport_weight = allocation_weights(allocation_mode)

    # Clone with scaled supply/demand for simulation
    farm_by_id = {}
    for f in farms:
        qty = safe_float(f.get("quantity"), 0.0)
        desired_qty = safe_float(f.get("desired_quantity"), 0.0)
        lat = safe_float(f.get("latitude"), 0.0)
        lon = safe_float(f.get("longitude"), 0.0)
        farm_by_id[f["id"]] = {
            **f,
            "quantity": max(0.0, qty * supply_mult),
            "desired_quantity": max(0.0, desired_qty * demand_mult),
            "latitude": lat,
            "longitude": lon,
        }
    ind_by_id = {}
    for i in industries:
        qty = safe_float(i.get("quantity_needed"), 0.0)
        byproduct_qty = safe_float(i.get("byproduct_quantity"), 0.0)
        lat = safe_float(i.get("latitude"), 0.0)
        lon = safe_float(i.get("longitude"), 0.0)
        ind_by_id[i["id"]] = {
            **i,
            "quantity_needed": max(0.0, qty * demand_mult),
            "byproduct_quantity": max(0.0, byproduct_qty * supply_mult),
            "latitude": lat,
            "longitude": lon,
        }

    # Unified Edge Generation for all-to-all flows: F->I, I->F, F->F, I->I
    edges = []
    edge_distance = {}
    nodes = []
    for f_id, f_data in farm_by_id.items():
        nodes.append({"id": f_id, "type": "FARM", "data": f_data})
    for i_id, i_data in ind_by_id.items():
        nodes.append({"id": i_id, "type": "INDUSTRY", "data": i_data})

    for src in nodes:
        s_id = src["id"]
        s_data = src["data"]
        if not s_data.get("isActive", True):
            continue
        
        # Source as Provider
        s_supply = s_data["quantity"] if src["type"] == "FARM" else s_data["byproduct_quantity"]
        s_waste_type = s_data.get("waste_type") if src["type"] == "FARM" else s_data.get("byproduct_type")
        
        if s_supply <= 0 or not str(s_waste_type or "").strip():
            continue

        for dst in nodes:
            # No self-loops
            if s_id == dst["id"]:
                continue
                
            d_id = dst["id"]
            d_data = dst["data"]
            if not d_data.get("isActive", True):
                continue
            
            # Destination as Receiver
            d_demand = d_data["quantity_needed"] if dst["type"] == "INDUSTRY" else d_data["desired_quantity"]
            d_required_type = d_data.get("required_type") if dst["type"] == "INDUSTRY" else d_data.get("desired_type")

            if d_demand <= 0 or not str(d_required_type or "").strip():
                continue
                
            if not is_compatible(s_waste_type, d_required_type):
                continue

            dist = haversine_km(
                s_data["latitude"], s_data["longitude"],
                d_data["latitude"], d_data["longitude"]
            )
            
            # Label the flow: SRC_TYPE_TO_DST_TYPE
            flow_label = f"{src['type']}_TO_{dst['type']}"
            edges.append((flow_label, s_id, d_id))
            edge_distance[(flow_label, s_id, d_id)] = dist

    if not edges:
        return {
            "matches": [],
            "total_revenue": 0,
            "total_transport_cost": 0,
            "co2_saved": 0,
            "landfill_diverted": 0,
            "scenario": sim,
        }

    prob = LpProblem("BioLoopMatch", LpMaximize)
    # Variable: quantity for each flow edge
    vars_map = {}
    for flow, fid, iid in edges:
        var_name = f"x_{flow[0]}_{fid}_{iid}"
        vars_map[(flow, fid, iid)] = LpVariable(var_name, lowBound=0, cat="Continuous")

    # Objective: revenue - transport_cost + carbon value, weighted by scenario preference
    obj = 0
    for (flow, fid, iid), v in vars_map.items():
        dist = edge_distance[(flow, fid, iid)]
        revenue = revenue_per_tonne * v * revenue_weight
        transport = cost_per_km_tonne * dist * v * transport_weight
        carbon = carbon_value_per_tco2 * co2_saved_per_tonne * v
        obj += revenue - transport + carbon
    prob += obj

    # Supply constraints: For each node, sum of all *outbound* flows <= its supply capacity
    # Demand constraints: For each node, sum of all *inbound* flows <= its demand capacity
    
    for f_id, f_data in farm_by_id.items():
        # Outbound from farm
        prob += lpSum(
            v for (flow, s, d), v in vars_map.items()
            if s == f_id
        ) <= f_data["quantity"]
        
        # Inbound to farm (Flow into farm's 'desired' capacity)
        prob += lpSum(
            v for (flow, s, d), v in vars_map.items()
            if d == f_id
        ) <= f_data["desired_quantity"]

    for i_id, i_data in ind_by_id.items():
        # Outbound from industry (byproduct)
        prob += lpSum(
            v for (flow, s, d), v in vars_map.items()
            if s == i_id
        ) <= i_data["byproduct_quantity"]
        
        # Inbound to industry (raw material demand)
        prob += lpSum(
            v for (flow, s, d), v in vars_map.items()
            if d == i_id
        ) <= i_data["quantity_needed"]

    prob.solve(PULP_CBC_CMD(msg=0))
    status = LpStatus.get(prob.status, "Unknown")

    matches = []
    total_revenue = 0.0
    total_transport_cost = 0.0
    landfill_diverted = 0.0

    for (flow, fid, iid), v in vars_map.items():
        q = v.varValue
        if q is None or q <= 0:
            continue
        q = round(float(q), 2)
        dist = edge_distance[(flow, fid, iid)]
        transport_cost = round(cost_per_km_tonne * dist * q, 2)
        revenue = round(revenue_per_tonne * q, 2)
        co2 = co2_saved_per_tonne * q
        # Sustainability score 0–1: higher if more CO2 saved and less distance
        sustainability_score = round(min(1.0, 0.5 + co2 / 100.0 - dist / 500.0), 2)
        sustainability_score = max(0.0, min(1.0, sustainability_score))

        # Determine source and destination node data based on flow label
        src_type, _, dst_type = flow.split("_")
        
        if src_type == "FARM":
            src_node = farm_by_id[fid]
            src_name = src_node.get("name", fid)
        else:
            src_node = ind_by_id[fid] # fid is the source id regardless of type in vars_map
            src_name = src_node.get("name", fid)
            
        if dst_type == "FARM":
            dst_node = farm_by_id[iid]
            dst_name = dst_node.get("name", iid)
        else:
            dst_node = ind_by_id[iid]
            dst_name = dst_node.get("name", iid)

        matches.append({
            "src_id": fid,
            "src_name": src_name,
            "src_type": src_type,
            "dst_id": iid,
            "dst_name": dst_name,
            "dst_type": dst_type,
            "farm_id": fid if src_type == "FARM" else (iid if dst_type == "FARM" else None),
            "farm_name": src_name if src_type == "FARM" else (dst_name if dst_type == "FARM" else None),
            "industry_id": fid if src_type == "INDUSTRY" else (iid if dst_type == "INDUSTRY" else None),
            "industry_name": src_name if src_type == "INDUSTRY" else (dst_name if dst_type == "INDUSTRY" else None),
            "flow": flow,
            "quantity_matched": q,
            "distance_km": round(dist, 2),
            "transport_cost": transport_cost,
            "revenue": revenue,
            "sustainability_score": sustainability_score,
            "co2_saved": round(co2, 2),
        })
        total_revenue += revenue
        total_transport_cost += transport_cost
        landfill_diverted += q

    co2_saved = round(landfill_diverted * co2_saved_per_tonne, 2)

    return {
        "matches": matches,
        "total_revenue": round(total_revenue, 2),
        "total_transport_cost": round(total_transport_cost, 2),
        "co2_saved": co2_saved,
        "landfill_diverted": round(landfill_diverted, 2),
        "status": status,
        "scenario": sim,
    }


def main():
    """Read JSON from stdin: { farms: [...], industries: [...], simulation?: {...} }. Write result JSON to stdout."""
    try:
        payload = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON: {e}"}), file=sys.stderr)
        sys.exit(1)
    farms = payload.get("farms", [])
    industries = payload.get("industries", [])
    simulation = build_simulation_config(payload)
    result = run_optimization(farms, industries, simulation)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
