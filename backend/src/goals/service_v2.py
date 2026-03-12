from __future__ import annotations

from datetime import datetime
from math import ceil
from statistics import mean
from typing import Any, Dict, List, Optional, Tuple
import json
import re
import uuid
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .schemas import GoalPlannerV2Panel, GoalPlannerV2Plan, GoalPlannerV2Progress, GoalPlannerV2Prompt, GoalPlannerV2Session


PRODUCT_BENCHMARKS = [
    {"kind": "bike", "name": "TVS Raider", "aliases": ["raider", "tvs"], "price_inr": 125000},
    {"kind": "bike", "name": "Honda Shine", "aliases": ["shine", "honda"], "price_inr": 110000},
    {"kind": "car", "name": "Maruti Alto K10", "aliases": ["alto"], "price_inr": 550000},
    {"kind": "car", "name": "Maruti Baleno", "aliases": ["baleno"], "price_inr": 850000},
    {"kind": "phone", "name": "iPhone 15", "aliases": ["iphone"], "price_inr": 80000},
    {"kind": "phone", "name": "OnePlus Nord", "aliases": ["oneplus", "nord"], "price_inr": 32000},
    {"kind": "laptop", "name": "Acer Aspire 5", "aliases": ["acer", "aspire"], "price_inr": 52000},
    {"kind": "laptop", "name": "MacBook Air", "aliases": ["macbook"], "price_inr": 110000},
]

MERCADO_SITES = ["MLM", "MLA", "MCO"]

TRIP_BENCHMARKS = {
    "japan": {"budget": 9000, "standard": 13000, "premium": 22000, "flight": 55000, "visa": 2500},
    "thailand": {"budget": 5000, "standard": 8500, "premium": 15000, "flight": 22000, "visa": 3000},
    "dubai": {"budget": 7000, "standard": 11000, "premium": 18000, "flight": 26000, "visa": 8000},
    "singapore": {"budget": 9000, "standard": 14000, "premium": 24000, "flight": 32000, "visa": 2500},
}


def _f(v: Any, d: float = 0.0) -> float:
    try:
        return float(v if v is not None else d)
    except Exception:
        return d


def _i(v: Any, d: int = 0) -> int:
    try:
        return int(float(v if v is not None else d))
    except Exception:
        return d


class GoalPlannerV2Service:
    def __init__(self, db: Any) -> None:
        self.db = db

    async def start(self, *, user_id: str, force_new: bool = False) -> GoalPlannerV2Progress:
        if not force_new:
            active = await self.db.goal_planner_sessions_v2.find_one({"user_id": user_id, "status": {"$in": ["collecting", "planning"]}}, sort=[("updated_at", -1)])
            if active:
                return await self._progress(GoalPlannerV2Session(**active))
        s = GoalPlannerV2Session(user_id=user_id)
        await self.db.goal_planner_sessions_v2.insert_one(s.model_dump())
        return await self._progress(s)

    async def get_progress(self, *, user_id: str, session_id: str) -> GoalPlannerV2Progress:
        doc = await self.db.goal_planner_sessions_v2.find_one({"id": session_id, "user_id": user_id})
        if not doc:
            raise ValueError("Planner v2 session not found")
        return await self._progress(GoalPlannerV2Session(**doc))

    async def turn(self, *, user_id: str, session_id: str, message: Any) -> GoalPlannerV2Progress:
        doc = await self.db.goal_planner_sessions_v2.find_one({"id": session_id, "user_id": user_id, "status": {"$in": ["collecting", "planning"]}})
        if not doc:
            raise ValueError("Active planner v2 session not found")
        s = GoalPlannerV2Session(**doc)
        expected = str(s.goal_context.get("expected_prompt_key", "")).strip()
        if expected:
            s.goal_context[expected] = self._parse_input(expected, message)
        s.dialogue.append({"role": "user", "content": str(message), "ts": datetime.utcnow().isoformat()})
        s.turn_count += 1
        s.updated_at = datetime.utcnow()

        outputs, missing, confidence = await self._run_agents(user_id=user_id, session=s)
        s.agent_outputs = outputs
        s.unresolved_fields = missing
        s.confidence = confidence

        done = (not missing and confidence >= 0.75) or s.turn_count >= s.max_turns
        if done:
            s.status = "planning"
            plan = await self._build_plan(user_id=user_id, session=s)
            s.plan_id = plan.id
            s.status = "completed"
            await self.db.goal_planner_sessions_v2.update_one({"id": s.id}, {"$set": s.model_dump()})
            return GoalPlannerV2Progress(
                session_id=s.id,
                status="completed",
                assistant_message=plan.summary,
                next_prompt=None,
                panels=plan.panels,
                progress={"phase": "completed", "turn_count": s.turn_count, "max_turns": s.max_turns, "confidence": round(confidence, 2)},
                plan=plan,
            )

        prompt = self._next_prompt(s)
        if prompt.key == expected:
            remaining = self._missing(dict(s.goal_context))
            if len(remaining) > 1:
                alt_key = remaining[1]
                prompt_map = {
                    "goal_text": GoalPlannerV2Prompt(key="goal_text", prompt="What goal do you want to plan?", input_type="text", required=True),
                    "target_amount": GoalPlannerV2Prompt(key="target_amount", prompt="What is your target amount for this goal? (INR)", input_type="number", required=True),
                    "target_months": GoalPlannerV2Prompt(key="target_months", prompt="In how many months do you want to complete this goal?", input_type="number", required=True),
                    "current_savings": GoalPlannerV2Prompt(key="current_savings", prompt="How much have you already saved for this goal?", input_type="number", required=True),
                    "monthly_commitment": GoalPlannerV2Prompt(key="monthly_commitment", prompt="How much can you save monthly for this goal?", input_type="number", required=True),
                    "goal_model": GoalPlannerV2Prompt(key="goal_model", prompt="Any specific model in mind? (or type 'skip')", input_type="text", required=False),
                    "trip_destination": GoalPlannerV2Prompt(key="trip_destination", prompt="Which country is this trip for?", input_type="text", required=True),
                    "trip_days": GoalPlannerV2Prompt(key="trip_days", prompt="How many days for this trip?", input_type="number", required=True),
                    "trip_travelers": GoalPlannerV2Prompt(key="trip_travelers", prompt="How many travelers?", input_type="number", required=True),
                    "trip_style": GoalPlannerV2Prompt(key="trip_style", prompt="Preferred trip style?", input_type="choice", choices=["budget", "standard", "premium"], required=True),
                }
                prompt = prompt_map.get(alt_key, prompt)
        s.goal_context["expected_prompt_key"] = prompt.key
        msg = f"I need one more detail: {prompt.prompt}"
        s.dialogue.append({"role": "assistant", "content": msg, "ts": datetime.utcnow().isoformat()})
        await self.db.goal_planner_sessions_v2.update_one({"id": s.id}, {"$set": s.model_dump()})
        return GoalPlannerV2Progress(
            session_id=s.id,
            status="collecting",
            assistant_message=msg,
            next_prompt=prompt,
            panels=self._panels(s, include_exec=False),
            progress={"phase": "collecting", "turn_count": s.turn_count, "max_turns": s.max_turns, "confidence": round(confidence, 2), "missing_fields": missing},
            plan=None,
        )

    async def list_user_plans(self, *, user_id: str, limit: int = 10) -> List[GoalPlannerV2Plan]:
        docs_v2 = await self.db.goal_plans_v2.find({"user_id": user_id}).sort("created_at", -1).limit(limit).to_list(limit)
        plans = [GoalPlannerV2Plan(**d) for d in docs_v2]
        remaining = max(0, limit - len(plans))
        if remaining <= 0:
            return plans
        docs_v1 = await self.db.goal_plans.find({"user_id": user_id}).sort("created_at", -1).limit(remaining).to_list(remaining)
        for item in docs_v1:
            plans.append(
                GoalPlannerV2Plan(
                    id=str(item.get("id", str(uuid.uuid4()))),
                    user_id=user_id,
                    session_id=str(item.get("session_id", "")),
                    source="v1",
                    goal_type="legacy",
                    goal_title=str(item.get("goal_name", "Legacy Goal")),
                    target_amount=_f(item.get("target_amount", 0.0)),
                    target_months=max(1, _i(item.get("target_months", 12), 12)),
                    estimated_monthly_required=_f(item.get("required_monthly_for_goal", 0.0)),
                    recommended_monthly=_f(item.get("monthly_budget_recommended", 0.0)),
                    projected_completion_months=max(1, _i(item.get("projected_completion_months", 12), 12)),
                    feasible_now=bool(item.get("feasible_now", False)),
                    confidence=0.55,
                    cost_model={"source": "legacy_v1", "confidence": 0.55, "fallback_reason": "legacy_conversion"},
                    feasibility={"status": "legacy"},
                    alternatives=[],
                    execution_phases=list(item.get("flow_steps", [])),
                    panels=[],
                    summary=str(item.get("summary", "Legacy goal plan")).strip() or "Legacy goal plan",
                    created_at=item.get("created_at", datetime.utcnow()) if isinstance(item.get("created_at"), datetime) else datetime.utcnow(),
                )
            )
        return plans

    async def _progress(self, s: GoalPlannerV2Session) -> GoalPlannerV2Progress:
        if s.status == "completed" and s.plan_id:
            doc = await self.db.goal_plans_v2.find_one({"id": s.plan_id, "user_id": s.user_id})
            if doc:
                p = GoalPlannerV2Plan(**doc)
                return GoalPlannerV2Progress(session_id=s.id, status="completed", assistant_message=p.summary, next_prompt=None, panels=p.panels, progress={"phase": "completed"}, plan=p)
        if s.turn_count == 0 and not s.goal_context:
            prompt = GoalPlannerV2Prompt(key="goal_text", prompt="What financial goal do you want to plan right now?", input_type="text", required=True, placeholder="Example: Foreign trip to Japan")
            s.goal_context["expected_prompt_key"] = prompt.key
            await self.db.goal_planner_sessions_v2.update_one({"id": s.id}, {"$set": s.model_dump()}, upsert=True)
            return GoalPlannerV2Progress(session_id=s.id, status="collecting", assistant_message="I will create a personalized goal plan using your financial data.", next_prompt=prompt, panels=[], progress={"phase": "collecting", "turn_count": 0}, plan=None)
        prompt = self._next_prompt(s)
        return GoalPlannerV2Progress(session_id=s.id, status="collecting", assistant_message=f"I need one more detail: {prompt.prompt}", next_prompt=prompt, panels=self._panels(s, include_exec=False), progress={"phase": "collecting", "turn_count": s.turn_count, "missing_fields": s.unresolved_fields}, plan=None)

    async def _run_agents(self, *, user_id: str, session: GoalPlannerV2Session) -> Tuple[Dict[str, Any], List[str], float]:
        g = dict(session.goal_context)
        goal = str(g.get("goal_text", "")).lower()
        kind = "general"
        if any(t in goal for t in ["trip", "travel", "vacation", "holiday", "japan", "thailand", "dubai", "singapore"]):
            kind = "foreign_trip"
        elif any(t in goal for t in ["bike", "scooter", "motorcycle"]):
            kind = "bike"
        elif "car" in goal:
            kind = "car"
        elif any(t in goal for t in ["phone", "mobile", "iphone"]):
            kind = "phone"
        elif any(t in goal for t in ["laptop", "macbook"]):
            kind = "laptop"
        g["goal_kind"] = kind
        g["destination"] = self._extract_destination(goal) if kind == "foreign_trip" else ""

        g["financial_snapshot"] = await self._financial_snapshot(user_id)
        if "target_months" not in g:
            m = self._extract_months(goal)
            if m > 0:
                g["target_months"] = m
        if "target_amount" not in g:
            amt = self._extract_amount(goal)
            if amt > 0:
                g["target_amount"] = amt
        if kind == "foreign_trip":
            if not g.get("trip_destination") and g.get("destination"):
                g["trip_destination"] = g["destination"]
            if "trip_days" not in g:
                d = self._extract_days(goal)
                if d > 0:
                    g["trip_days"] = d
            if "trip_travelers" not in g:
                t = self._extract_travelers(goal)
                if t > 0:
                    g["trip_travelers"] = t

        g["cost_model"] = await self._cost_model(g)
        g["feasibility"] = self._feasibility(g)
        g["alternatives"] = self._alternatives(g)

        missing = self._missing(g)
        conf = self._confidence(g, missing)
        session.goal_context = g
        return {"intent": {"goal_kind": kind}, "feasibility": g["feasibility"], "cost_model": g["cost_model"]}, missing, conf

    async def _financial_snapshot(self, user_id: str) -> Dict[str, Any]:
        u = await self.db.users.find_one({"id": user_id}) or {}
        tx = await self.db.transactions.find({"user_id": user_id}).sort("date", -1).limit(2500).to_list(2500)
        now = datetime.utcnow()
        recent = []
        for r in tx:
            dt = self._dt(r.get("date", r.get("created_at")))
            if (now - dt).days <= 120:
                recent.append(r)
        debit = [_f(x.get("amount", 0.0)) for x in recent if str(x.get("transaction_type", "debit")).lower() in {"debit", "self_transfer"}]
        credit = [_f(x.get("amount", 0.0)) for x in recent if str(x.get("transaction_type", "debit")).lower() == "credit"]
        months = max(1, len({(self._dt(x.get("date", x.get("created_at"))).year, self._dt(x.get("date", x.get("created_at"))).month) for x in recent}))
        spend_m = sum(debit) / months
        credit_m = sum(credit) / months
        income_m = _f(u.get("monthly_income", 0.0)) or credit_m or (spend_m * 1.2 if spend_m > 0 else 0.0)
        return {"monthly_income_estimate": round(income_m, 2), "monthly_spend_estimate": round(spend_m, 2), "monthly_surplus_estimate": round(max(0.0, income_m - spend_m), 2), "safe_monthly_goal_budget": round(max(0.0, (income_m - spend_m) * 0.7), 2), "avg_txn_amount": round(mean(debit), 2) if debit else 0.0}

    async def _cost_model(self, g: Dict[str, Any]) -> Dict[str, Any]:
        kind = str(g.get("goal_kind", "general"))
        goal_text = str(g.get("goal_text", ""))
        user_target = _f(g.get("target_amount", 0.0))
        if kind == "foreign_trip":
            live = await self._live_trip(g)
            if live.get("source") == "live_api":
                if user_target > 0:
                    live["market_estimate_inr"] = _f(live.get("estimated_total_inr", 0.0))
                    live["estimated_total_inr"] = round(user_target, 2)
                    assumptions = list(live.get("assumptions", []))
                    assumptions.append("User target amount overrides estimate for planning.")
                    live["assumptions"] = assumptions
                return live
            bench = self._bench_trip(g)
            if user_target > 0:
                bench["market_estimate_inr"] = _f(bench.get("estimated_total_inr", 0.0))
                bench["estimated_total_inr"] = user_target
            return bench
        live = await self._live_product(goal_text or kind)
        if live.get("source") == "live_api":
            if user_target > 0:
                live["market_estimate_inr"] = _f(live.get("estimated_total_inr", 0.0))
                live["estimated_total_inr"] = round(user_target, 2)
                assumptions = list(live.get("assumptions", []))
                assumptions.append("User target amount overrides estimate for planning.")
                live["assumptions"] = assumptions
            return live
        if kind in {"bike", "car", "phone", "laptop"}:
            cands = [x for x in PRODUCT_BENCHMARKS if x["kind"] == kind]
            sel = cands[0] if cands else {"name": "Estimated", "price_inr": 100000}
            for x in cands:
                low = goal_text.lower()
                if x["name"].lower() in low or any(a in low for a in x["aliases"]):
                    sel = x
                    break
            price = user_target or _f(sel["price_inr"], 100000.0)
            return {"source": "benchmark", "confidence": 0.62, "estimated_total_inr": round(price, 2), "line_items": [{"label": sel["name"], "amount_inr": round(price, 2)}], "fallback_reason": "benchmark_used", "assumptions": ["Benchmark catalog used."]}
        est = user_target or 100000.0
        return {"source": "benchmark", "confidence": 0.45, "estimated_total_inr": round(est, 2), "line_items": [{"label": "Goal Estimate", "amount_inr": round(est, 2)}], "fallback_reason": "benchmark_used", "assumptions": ["No live estimate available."]}

    def _feasibility(self, g: Dict[str, Any]) -> Dict[str, Any]:
        s = dict(g.get("financial_snapshot", {}))
        c = dict(g.get("cost_model", {}))
        total = max(1.0, _f(c.get("estimated_total_inr", 0.0), 1.0))
        cur = max(0.0, _f(g.get("current_savings", 0.0)))
        months = max(1, _i(g.get("target_months", 12), 12))
        commit = max(0.0, _f(g.get("monthly_commitment", 0.0)))
        safe = max(0.0, _f(s.get("safe_monthly_goal_budget", 0.0)))
        rec = commit if commit > 0 else safe
        needed = max(0.0, total - cur)
        req = needed / months
        proj = min(72, max(1, ceil(needed / max(1.0, rec))))
        affordable = cur + rec * months
        gap = max(0.0, total - affordable)
        feasible = gap <= 0 and proj <= months
        return {"target_amount_inr": round(total, 2), "current_savings_inr": round(cur, 2), "required_monthly_inr": round(req, 2), "recommended_monthly_inr": round(rec, 2), "safe_monthly_inr": round(safe, 2), "affordable_in_timeline_inr": round(affordable, 2), "gap_amount_inr": round(gap, 2), "projected_completion_months": proj, "target_months": months, "feasible_now": feasible, "status": "affordable" if feasible else "stretch"}

    def _alternatives(self, g: Dict[str, Any]) -> List[Dict[str, Any]]:
        f = dict(g.get("feasibility", {}))
        limit = _f(f.get("affordable_in_timeline_inr", 0.0))
        kind = str(g.get("goal_kind", "general"))
        out: List[Dict[str, Any]] = []
        if kind in {"bike", "car", "phone", "laptop"}:
            market_opts = list((g.get("cost_model", {}) or {}).get("market_options", []))
            if market_opts:
                sorted_opts = sorted(market_opts, key=lambda x: _f(x.get("amount_inr", 0.0)))
                for opt in sorted_opts[:4]:
                    p = _f(opt.get("amount_inr", 0.0))
                    fit = "strong" if p <= max(limit, _f(f.get("target_amount_inr", 0.0))) else "stretch"
                    out.append({"name": str(opt.get("label", "Market Option")), "estimated_price_inr": round(p, 2), "fit": fit})
            else:
                rows = sorted([x for x in PRODUCT_BENCHMARKS if x["kind"] == kind], key=lambda x: _f(x["price_inr"]))
                for r in rows[:4]:
                    p = _f(r["price_inr"])
                    if bool(f.get("feasible_now", False)):
                        fit = "on_track" if p <= max(limit, _f(f.get("target_amount_inr", 0.0))) else "upgrade"
                    else:
                        fit = "strong" if p <= limit else "stretch"
                    out.append({"name": r["name"], "estimated_price_inr": round(p, 2), "fit": fit})
        if kind == "foreign_trip":
            d = str(g.get("trip_destination", "thailand")).lower()
            days = max(3, _i(g.get("trip_days", 7), 7))
            t = max(1, _i(g.get("trip_travelers", 1), 1))
            for st in ["budget", "standard", "premium"]:
                e = self._bench_trip({"trip_destination": d, "trip_days": days, "trip_travelers": t, "trip_style": st})
                p = _f(e.get("estimated_total_inr", 0.0))
                if bool(f.get("feasible_now", False)):
                    fit = "recommended" if st in {"budget", "standard"} else "premium_option"
                else:
                    fit = "strong" if p <= limit else "stretch"
                out.append({"name": f"{d.title()} ({st})", "estimated_price_inr": round(p, 2), "fit": fit})
        if kind == "general":
            out.extend(
                [
                    {"name": "Core plan", "estimated_price_inr": round(_f(f.get("target_amount_inr", 0.0)), 2), "fit": "recommended"},
                    {
                        "name": "Fast-track plan (+15% monthly savings)",
                        "estimated_price_inr": round(_f(f.get("target_amount_inr", 0.0)), 2),
                        "fit": "faster",
                    },
                    {
                        "name": "Comfort plan (+20% timeline)",
                        "estimated_price_inr": round(_f(f.get("target_amount_inr", 0.0)), 2),
                        "fit": "easier",
                    },
                ]
            )
        return out[:4]

    def _missing(self, g: Dict[str, Any]) -> List[str]:
        kind = str(g.get("goal_kind", "general"))
        m = []
        if not g.get("goal_text"):
            m.append("goal_text")
        if not g.get("target_amount"):
            m.append("target_amount")
        if not g.get("target_months"):
            m.append("target_months")
        if g.get("current_savings") is None:
            m.append("current_savings")
        if g.get("monthly_commitment") is None:
            m.append("monthly_commitment")
        if kind == "foreign_trip":
            if not g.get("trip_destination"):
                m.append("trip_destination")
            if not g.get("trip_days"):
                m.append("trip_days")
            if not g.get("trip_travelers"):
                m.append("trip_travelers")
            if not g.get("trip_style"):
                m.append("trip_style")
        return m

    def _confidence(self, g: Dict[str, Any], missing: List[str]) -> float:
        kind = str(g.get("goal_kind", "general"))
        fields = ["goal_text", "target_months", "current_savings", "monthly_commitment"] + (["trip_destination", "trip_days", "trip_travelers", "trip_style"] if kind == "foreign_trip" else ["goal_model"] if kind in {"bike", "car", "phone", "laptop"} else [])
        ok = sum(1 for k in fields if g.get(k) not in [None, "", 0] or (k == "current_savings" and g.get(k) == 0))
        ratio = ok / max(1, len(fields))
        cm = _f((g.get("cost_model", {}) or {}).get("confidence", 0.0))
        return max(0.2, min(0.98, ratio * 0.75 + cm * 0.2 + (0.1 if not missing else 0.0)))

    def _next_prompt(self, s: GoalPlannerV2Session) -> GoalPlannerV2Prompt:
        g = dict(s.goal_context)
        m = self._missing(g)
        key = m[0] if m else "goal_text"
        p = {
            "goal_text": GoalPlannerV2Prompt(key="goal_text", prompt="What goal do you want to plan?", input_type="text", required=True),
            "target_amount": GoalPlannerV2Prompt(key="target_amount", prompt="What is your target amount for this goal? (INR)", input_type="number", required=True, placeholder="Example: 150000"),
            "target_months": GoalPlannerV2Prompt(key="target_months", prompt="In how many months do you want to complete this goal?", input_type="number", required=True, placeholder="Example: 12"),
            "current_savings": GoalPlannerV2Prompt(key="current_savings", prompt="How much have you already saved for this goal?", input_type="number", required=True, placeholder="Example: 20000"),
            "monthly_commitment": GoalPlannerV2Prompt(key="monthly_commitment", prompt="How much can you save monthly for this goal?", input_type="number", required=True, placeholder="Example: 12000"),
            "goal_model": GoalPlannerV2Prompt(key="goal_model", prompt="Any specific model in mind?", input_type="text", required=False, placeholder="Example: iPhone 15"),
            "trip_destination": GoalPlannerV2Prompt(key="trip_destination", prompt="Which country is this trip for?", input_type="text", required=True, placeholder="Example: Japan"),
            "trip_days": GoalPlannerV2Prompt(key="trip_days", prompt="How many days for this trip?", input_type="number", required=True),
            "trip_travelers": GoalPlannerV2Prompt(key="trip_travelers", prompt="How many travelers?", input_type="number", required=True),
            "trip_style": GoalPlannerV2Prompt(key="trip_style", prompt="Preferred trip style?", input_type="choice", choices=["budget", "standard", "premium"], required=True),
        }
        return p.get(key, p["goal_text"])

    async def _build_plan(self, *, user_id: str, session: GoalPlannerV2Session) -> GoalPlannerV2Plan:
        g = dict(session.goal_context)
        f = dict(g.get("feasibility", {}))
        p = GoalPlannerV2Plan(
            user_id=user_id,
            session_id=session.id,
            goal_type=str(g.get("goal_kind", "general")),
            goal_title=str(g.get("goal_text", "Goal")),
            target_amount=_f(f.get("target_amount_inr", 0.0)),
            target_months=max(1, _i(f.get("target_months", 12), 12)),
            estimated_monthly_required=_f(f.get("required_monthly_inr", 0.0)),
            recommended_monthly=_f(f.get("recommended_monthly_inr", 0.0)),
            projected_completion_months=max(1, _i(f.get("projected_completion_months", 12), 12)),
            feasible_now=bool(f.get("feasible_now", False)),
            confidence=round(session.confidence, 2),
            cost_model=dict(g.get("cost_model", {})),
            feasibility=f,
            alternatives=list(g.get("alternatives", [])),
            execution_phases=self._execution(g),
            panels=self._panels(session, include_exec=True),
            summary=self._summary(g),
        )
        await self.db.goal_plans_v2.insert_one(p.model_dump())
        return p

    def _execution(self, g: Dict[str, Any]) -> List[Dict[str, Any]]:
        f = dict(g.get("feasibility", {}))
        target = _f(f.get("target_amount_inr", 0.0))
        cur = _f(f.get("current_savings_inr", 0.0))
        proj = max(1, _i(f.get("projected_completion_months", 12), 12))
        m = _f(f.get("recommended_monthly_inr", 0.0))
        need = max(0.0, target - cur)
        return [
            {
                "phase": "Phase 1",
                "title": "Foundation",
                "duration_months": 1,
                "actions": [f"Auto-save around \u20B9{m:,.0f}/month.", "Cut one discretionary category by 10%."]
            },
            {
                "phase": "Phase 2",
                "title": "Execution",
                "duration_months": proj,
                "milestones": [
                    {"month": max(1, proj // 3), "target_saved_inr": round(cur + need * 0.33, 2)},
                    {"month": max(2, (proj * 2) // 3), "target_saved_inr": round(cur + need * 0.66, 2)},
                    {"month": proj, "target_saved_inr": round(target, 2)},
                ],
            },
        ]

    def _panels(self, s: GoalPlannerV2Session, include_exec: bool) -> List[GoalPlannerV2Panel]:
        g = dict(s.goal_context)
        snap = dict(g.get("financial_snapshot", {}))
        cost = dict(g.get("cost_model", {}))
        f = dict(g.get("feasibility", {}))
        alts = list(g.get("alternatives", []))
        panels = [
            GoalPlannerV2Panel(id="financial_capacity", title="Financial Capacity", summary="Based on your profile and recent transactions.", items=[
                {"label": "Income / month", "value": f"\u20B9{_f(snap.get('monthly_income_estimate', 0.0)):,.0f}"},
                {"label": "Spend / month", "value": f"\u20B9{_f(snap.get('monthly_spend_estimate', 0.0)):,.0f}"},
                {"label": "Safe goal budget", "value": f"\u20B9{_f(snap.get('safe_monthly_goal_budget', 0.0)):,.0f}"},
            ]),
            GoalPlannerV2Panel(id="goal_cost", title="Goal Cost & Assumptions", summary=f"Source: {str(cost.get('source', 'benchmark'))}", items=[
                {"label": "Estimated total", "value": f"\u20B9{_f(cost.get('estimated_total_inr', 0.0)):,.0f}"}
            ] + [{"label": str(r.get("label", "Cost")), "value": f"\u20B9{_f(r.get('amount_inr', 0.0)):,.0f}"} for r in list(cost.get("line_items", []))[:6]]),
            GoalPlannerV2Panel(id="affordability", title="Affordability Verdict", summary=str(f.get("status", "unknown")).capitalize(), items=[
                {"label": "Required / month", "value": f"\u20B9{_f(f.get('required_monthly_inr', 0.0)):,.0f}"},
                {"label": "Recommended / month", "value": f"\u20B9{_f(f.get('recommended_monthly_inr', 0.0)):,.0f}"},
                {"label": "Gap", "value": f"\u20B9{_f(f.get('gap_amount_inr', 0.0)):,.0f}"},
                {"label": "Projected completion", "value": f"{_i(f.get('projected_completion_months', 0))} months"},
            ]),
        ]
        if alts:
            panels.append(GoalPlannerV2Panel(id="alternatives", title="Alternatives", summary="Affordable options.", items=[
                {"label": str(a.get("name", "Option")), "value": f"\u20B9{_f(a.get('estimated_price_inr', 0.0)):,.0f} ({str(a.get('fit', 'stretch'))})"}
                for a in alts[:4]
            ]))
        if include_exec:
            panels.append(GoalPlannerV2Panel(id="execution", title="Execution Roadmap", summary="Step-by-step plan.", items=[
                {"label": f"{p.get('phase', 'Phase')}: {p.get('title', '')}", "value": f"{_i(p.get('duration_months', 1), 1)} months"}
                for p in self._execution(g)
            ]))
        if str(g.get("goal_kind", "")) == "foreign_trip":
            panels.append(GoalPlannerV2Panel(id="trip_budget", title="Trip Budget Breakdown", summary="Detailed INR breakdown.", items=[
                {"label": str(r.get("label", "Cost")), "value": f"\u20B9{_f(r.get('amount_inr', 0.0)):,.0f}"}
                for r in list(cost.get("line_items", []))[:8]
            ]))
        return panels

    def _summary(self, g: Dict[str, Any]) -> str:
        f = dict(g.get("feasibility", {}))
        goal = str(g.get("goal_text", "your goal"))
        return (
            f"Plan ready for '{goal}'. Target \u20B9{_f(f.get('target_amount_inr', 0.0)):,.0f}, "
            f"required \u20B9{_f(f.get('required_monthly_inr', 0.0)):,.0f}/month, "
            f"recommended \u20B9{_f(f.get('recommended_monthly_inr', 0.0)):,.0f}/month, "
            f"expected completion {_i(f.get('projected_completion_months', 12), 12)} months."
        )

    async def _live_product(self, query: str) -> Dict[str, Any]:
        try:
            market_options = await self._live_market_options(query)
            if not market_options:
                raise ValueError("no live options")
            options_sorted = sorted(market_options, key=lambda x: _f(x.get("amount_inr", 0.0)))
            baseline = _f(options_sorted[max(0, len(options_sorted) // 2)].get("amount_inr", 0.0))
            return {
                "source": "live_api",
                "confidence": 0.78,
                "estimated_total_inr": round(baseline, 2),
                "line_items": options_sorted[:6],
                "market_options": options_sorted[:6],
                "fallback_reason": "",
                "assumptions": ["Live marketplace results converted to INR median estimate."],
            }
        except Exception:
            return {"source": "benchmark", "confidence": 0.45, "estimated_total_inr": 0.0, "line_items": [], "fallback_reason": "live_api_failed", "assumptions": ["Live API failed, benchmark fallback used."]}

    async def _live_trip(self, g: Dict[str, Any]) -> Dict[str, Any]:
        try:
            cfg = await self.db.settings.find_one({"key": "goal_trip_cost_api"})
            url = str((cfg or {}).get("value", "")).strip()
            if not url:
                raise ValueError("not configured")
            payload = self._http_get_json(url, {
                "destination": str(g.get("trip_destination", "")),
                "days": max(3, _i(g.get("trip_days", 7), 7)),
                "travelers": max(1, _i(g.get("trip_travelers", 1), 1)),
                "style": str(g.get("trip_style", "standard")),
            }, timeout=5, retries=2)
            total = _f(payload.get("estimated_total_inr", 0.0))
            if total <= 0:
                raise ValueError("invalid")
            return {"source": "live_api", "confidence": max(0.4, min(0.9, _f(payload.get("confidence", 0.65)))), "estimated_total_inr": round(total, 2), "line_items": list(payload.get("line_items", [])), "fallback_reason": "", "assumptions": ["Live trip API used."]}
        except Exception as exc:
            reason = "live_api_not_configured" if "configured" in str(exc).lower() else "live_api_timeout"
            return {"source": "benchmark", "confidence": 0.45, "estimated_total_inr": 0.0, "line_items": [], "fallback_reason": reason, "assumptions": ["Live trip API unavailable."]}

    def _bench_trip(self, g: Dict[str, Any]) -> Dict[str, Any]:
        d = str(g.get("trip_destination", "thailand")).lower()
        days = max(3, _i(g.get("trip_days", 7), 7))
        t = max(1, _i(g.get("trip_travelers", 1), 1))
        st = str(g.get("trip_style", "standard")).lower()
        p = TRIP_BENCHMARKS.get(d, TRIP_BENCHMARKS["thailand"])
        day = _f(p.get(st, p["standard"]))
        flight = _f(p.get("flight", 30000.0))
        visa = _f(p.get("visa", 4000.0))
        stay = day * days * t
        flights = flight * t
        local = max(3000.0, stay * 0.08)
        ins = max(2500.0, stay * 0.05)
        cont = max(5000.0, (stay + flights) * 0.08)
        total = stay + flights + local + ins + cont + visa
        return {"source": "benchmark", "confidence": 0.64, "estimated_total_inr": round(total, 2), "line_items": [
            {"label": "Flights", "amount_inr": round(flights, 2)},
            {"label": "Stay + Daily Spend", "amount_inr": round(stay, 2)},
            {"label": "Visa", "amount_inr": round(visa, 2)},
            {"label": "Local Transport", "amount_inr": round(local, 2)},
            {"label": "Travel Insurance", "amount_inr": round(ins, 2)},
            {"label": "Contingency Buffer", "amount_inr": round(cont, 2)},
        ], "fallback_reason": "benchmark_used", "assumptions": [f"Benchmark used for {d} ({st})."]}

    async def _usd_inr(self) -> float:
        try:
            d = self._http_get_json("https://api.frankfurter.app/latest", {"from": "USD", "to": "INR"}, timeout=4, retries=2)
            r = _f(dict(d.get("rates", {})).get("INR", 0.0))
            if r > 1:
                return r
        except Exception:
            pass
        return 83.0

    def _parse_input(self, key: str, value: Any) -> Any:
        if key in {"target_months", "trip_days", "trip_travelers"}:
            n = _i(value, 0)
            if n <= 0:
                raise ValueError("Please enter a valid positive number.")
            return n
        if key in {"current_savings", "monthly_commitment", "target_amount"}:
            n = _f(value, -1)
            if n < 0:
                raise ValueError("Please enter a valid amount.")
            return round(n, 2)
        if key == "trip_style":
            t = str(value or "").strip().lower()
            if t not in {"budget", "standard", "premium"}:
                raise ValueError("Choose one: budget, standard, premium.")
            return t
        t = str(value or "").strip()
        if key == "goal_model" and t.lower() in {"skip", "none", "na", "n/a"}:
            return ""
        if not t:
            raise ValueError("Please provide a value.")
        return t[:250]

    def _extract_amount(self, text: str) -> float:
        m = re.search(r"(?:\u20B9|rs\.?|inr)?\s*([0-9][0-9,]*(?:\.[0-9]+)?)", text, flags=re.IGNORECASE)
        return _f(m.group(1).replace(",", "")) if m else 0.0

    def _extract_months(self, text: str) -> int:
        m = re.search(r"([0-9]{1,3})\s*(?:months?|mos?)", text, flags=re.IGNORECASE)
        if m:
            return max(1, _i(m.group(1), 0))
        y = re.search(r"([0-9]{1,2})\s*(?:years?|yrs?)", text, flags=re.IGNORECASE)
        return max(1, _i(y.group(1), 0) * 12) if y else 0

    def _extract_days(self, text: str) -> int:
        m = re.search(r"([0-9]{1,2})\s*(?:days?)", text, flags=re.IGNORECASE)
        return max(1, _i(m.group(1), 0)) if m else 0

    def _extract_travelers(self, text: str) -> int:
        m = re.search(r"([0-9]{1,2})\s*(?:people|persons|travellers|travelers)", text, flags=re.IGNORECASE)
        return max(1, _i(m.group(1), 0)) if m else 0

    def _extract_destination(self, text: str) -> str:
        for d in TRIP_BENCHMARKS.keys():
            if d in text:
                return d
        m = re.search(r"to\s+([a-zA-Z]+)", text)
        return str(m.group(1)).lower() if m else ""

    def _dt(self, v: Any) -> datetime:
        if isinstance(v, datetime):
            return v
        if isinstance(v, str):
            try:
                return datetime.fromisoformat(v.replace("Z", "+00:00")).replace(tzinfo=None)
            except Exception:
                return datetime.utcnow()
        return datetime.utcnow()

    def _http_get_json(self, url: str, params: Optional[Dict[str, Any]] = None, *, timeout: int = 5, retries: int = 2) -> Dict[str, Any]:
        q = urlencode(params or {})
        full = f"{url}?{q}" if q else url
        err: Optional[Exception] = None
        for _ in range(max(1, retries)):
            try:
                req = Request(full, headers={"accept": "application/json", "user-agent": "SpendWiseGoalPlanner/2.0"})
                with urlopen(req, timeout=timeout) as r:
                    payload = json.loads(r.read().decode("utf-8") or "{}")
                    if isinstance(payload, dict):
                        return payload
                    raise ValueError("invalid json")
            except Exception as e:
                err = e
        if err:
            raise err
        return {}

    async def _live_market_options(self, query: str) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        clean_query = (query or "").strip() or "consumer product"
        for site in MERCADO_SITES:
            try:
                payload = self._http_get_json(
                    f"https://api.mercadolibre.com/sites/{site}/search",
                    {"q": clean_query, "limit": 8},
                    timeout=5,
                    retries=2,
                )
                results = list(payload.get("results", []))
                for row in results:
                    amount = _f(row.get("price", 0.0))
                    currency = str(row.get("currency_id", "USD")).upper()
                    if amount <= 0:
                        continue
                    inr = await self._to_inr(amount, currency)
                    if inr <= 0:
                        continue
                    out.append(
                        {
                            "label": str(row.get("title", "Market Option"))[:90],
                            "amount_inr": round(inr, 2),
                        }
                    )
            except Exception:
                continue
        dedup: Dict[str, Dict[str, Any]] = {}
        for item in out:
            key = f"{item['label']}-{int(_f(item['amount_inr'], 0))}"
            dedup[key] = item
        return list(dedup.values())[:12]

    async def _to_inr(self, amount: float, currency: str) -> float:
        cur = (currency or "").upper().strip()
        if cur == "INR":
            return amount
        if cur == "USD":
            return amount * (await self._usd_inr())
        try:
            data = self._http_get_json(
                "https://api.frankfurter.app/latest",
                {"from": cur, "to": "INR"},
                timeout=4,
                retries=2,
            )
            rate = _f(dict(data.get("rates", {})).get("INR", 0.0))
            if rate > 0:
                return amount * rate
        except Exception:
            pass
        # coarse fallback map for unsupported currencies
        coarse = {"MXN": 4.9, "ARS": 0.08, "COP": 0.02, "EUR": 90.0, "GBP": 105.0}
        return amount * _f(coarse.get(cur, 0.0), 0.0)


async def init_goal_module_v2(db: Any) -> None:
    await db.goal_planner_sessions_v2.create_index([("id", 1)], unique=True)
    await db.goal_planner_sessions_v2.create_index([("user_id", 1), ("status", 1), ("updated_at", -1)])
    await db.goal_plans_v2.create_index([("id", 1)], unique=True)
    await db.goal_plans_v2.create_index([("user_id", 1), ("created_at", -1)])
