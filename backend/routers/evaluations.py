"""Évaluations de performance — extraits de server.py."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from core.config import db
from core.security import get_current_user, get_principal, log_audit, scoped_pid

router = APIRouter(prefix="/evaluations", tags=["evaluations"])


def compute_answers_score(answers: dict) -> float:
    vals = [int(v) for v in answers.values()]
    if not vals or any(not (1 <= v <= 5) for v in vals):
        raise HTTPException(status_code=400, detail="Réponses invalides (échelle de 1 à 5).")
    return round(sum(vals) / (5 * len(vals)) * 100, 1)


def compute_salary_suggestion(doc: dict) -> Optional[dict]:
    admin_eval, self_eval = doc.get("admin_eval"), doc.get("self_eval")
    if not admin_eval or not self_eval:
        return None
    perf = round(0.7 * admin_eval["score"] + 0.3 * self_eval["score"], 1)
    if perf >= 90:
        mult = 1.2
    elif perf >= 75:
        mult = 1.0
    elif perf >= 60:
        mult = 0.7
    elif perf >= 45:
        mult = 0.4
    else:
        mult = 0.0
    inc = round(doc["baiia_increase_pct"] * mult, 2)
    rate = round(doc["current_rate"] * (1 + inc / 100) * 20) / 20
    return {"performance_score": perf, "multiplier": mult, "suggested_increase_pct": inc, "suggested_rate": rate}


class EvaluationCreateIn(BaseModel):
    employee_id: str
    employee_name: str
    current_rate: float
    baiia_increase_pct: float


class EmployerEvalIn(BaseModel):
    answers: dict
    strengths: str = ""
    improvements: str = ""
    objectives: str = ""


class SelfEvalIn(BaseModel):
    answers: dict
    accomplishments: str = ""
    needs: str = ""
    goals: str = ""


class ProposeRateIn(BaseModel):
    proposed_rate: float


class EvalRespondIn(BaseModel):
    accepted: bool
    comment: str = ""


async def get_evaluation_or_404(evaluation_id: str) -> dict:
    doc = await db.evaluations.find_one({"id": evaluation_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Évaluation introuvable.")
    return doc


@router.post("")
async def create_evaluation(payload: EvaluationCreateIn, principal: dict = Depends(get_principal)):
    pid = scoped_pid(principal)
    if payload.current_rate <= 0:
        raise HTTPException(status_code=400, detail="Taux horaire actuel invalide.")
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": str(uuid.uuid4()), "pharmacy_id": pid,
        "employee_id": payload.employee_id, "employee_name": payload.employee_name,
        "current_rate": payload.current_rate, "baiia_increase_pct": payload.baiia_increase_pct,
        "status": "en_cours", "admin_eval": None, "self_eval": None, "suggestion": None,
        "proposed_rate": None, "proposed_at": None, "employee_decision": None,
        "agreed_rate": None, "applied": False,
        "created_by": principal["email"], "created_at": now, "updated_at": now,
    }
    await db.evaluations.insert_one({**doc})
    await log_audit(
        principal["email"], principal["role"], "CREATION_EVALUATION", "évaluation", doc["id"],
        f"Évaluation lancée pour {payload.employee_name} (BAIIA +{payload.baiia_increase_pct} %)", pid,
    )
    return doc


@router.get("")
async def list_evaluations(user: dict = Depends(get_current_user)):
    if user["role"] in ("admin", "manager", "superadmin"):
        query: dict = {"pharmacy_id": scoped_pid(user)}
    else:
        if not user.get("employee_id"):
            return []
        query = {"pharmacy_id": user.get("pharmacy_id") or "", "employee_id": user["employee_id"]}
    return await db.evaluations.find(query, {"_id": 0}).sort("created_at", -1).to_list(200)


@router.put("/{evaluation_id}/employer")
async def submit_employer_eval(evaluation_id: str, payload: EmployerEvalIn, principal: dict = Depends(get_principal)):
    doc = await get_evaluation_or_404(evaluation_id)
    admin_eval = {
        "answers": payload.answers, "score": compute_answers_score(payload.answers),
        "strengths": payload.strengths, "improvements": payload.improvements,
        "objectives": payload.objectives, "completed_at": datetime.now(timezone.utc).isoformat(),
        "by": principal["email"],
    }
    merged = {**doc, "admin_eval": admin_eval}
    suggestion = compute_salary_suggestion(merged)
    patch = {
        "admin_eval": admin_eval, "suggestion": suggestion,
        "status": "a_proposer" if suggestion else "en_cours",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": patch})
    await log_audit(
        principal["email"], principal["role"], "EVALUATION_EMPLOYEUR", "évaluation", evaluation_id,
        f"Évaluation employeur de {doc['employee_name']} : {admin_eval['score']} %", doc["pharmacy_id"],
    )
    return {**merged, **patch}


@router.put("/{evaluation_id}/self")
async def submit_self_eval(evaluation_id: str, payload: SelfEvalIn, user: dict = Depends(get_current_user)):
    doc = await get_evaluation_or_404(evaluation_id)
    if user["role"] == "employee" and user.get("employee_id") != doc["employee_id"]:
        raise HTTPException(status_code=403, detail="Cette évaluation ne vous concerne pas.")
    self_eval = {
        "answers": payload.answers, "score": compute_answers_score(payload.answers),
        "accomplishments": payload.accomplishments, "needs": payload.needs,
        "goals": payload.goals, "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    merged = {**doc, "self_eval": self_eval}
    suggestion = compute_salary_suggestion(merged)
    patch = {
        "self_eval": self_eval, "suggestion": suggestion,
        "status": "a_proposer" if suggestion else "en_cours",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": patch})
    await log_audit(
        user["email"], user["role"], "AUTO_EVALUATION", "évaluation", evaluation_id,
        f"Auto-évaluation de {doc['employee_name']} : {self_eval['score']} %", doc["pharmacy_id"],
    )
    return {**merged, **patch}


@router.post("/{evaluation_id}/propose")
async def propose_rate(evaluation_id: str, payload: ProposeRateIn, principal: dict = Depends(get_principal)):
    doc = await get_evaluation_or_404(evaluation_id)
    if not doc.get("admin_eval") or not doc.get("self_eval"):
        raise HTTPException(status_code=400, detail="Les deux évaluations doivent être complétées avant de proposer un salaire.")
    if payload.proposed_rate <= 0:
        raise HTTPException(status_code=400, detail="Taux proposé invalide.")
    patch = {
        "proposed_rate": round(payload.proposed_rate, 2),
        "proposed_at": datetime.now(timezone.utc).isoformat(),
        "employee_decision": None, "status": "propose",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": patch})
    await log_audit(
        principal["email"], principal["role"], "PROPOSITION_SALAIRE", "évaluation", evaluation_id,
        f"Salaire proposé à {doc['employee_name']} : {patch['proposed_rate']} $/h (actuel {doc['current_rate']} $/h)",
        doc["pharmacy_id"],
    )
    return {**doc, **patch}


@router.post("/{evaluation_id}/respond")
async def respond_evaluation(evaluation_id: str, payload: EvalRespondIn, user: dict = Depends(get_current_user)):
    doc = await get_evaluation_or_404(evaluation_id)
    if user["role"] == "employee" and user.get("employee_id") != doc["employee_id"]:
        raise HTTPException(status_code=403, detail="Cette évaluation ne vous concerne pas.")
    if doc.get("proposed_rate") is None or doc["status"] not in ("propose",):
        raise HTTPException(status_code=400, detail="Aucune proposition salariale en attente.")
    decision = {"accepted": payload.accepted, "comment": payload.comment.strip(),
                "at": datetime.now(timezone.utc).isoformat()}
    patch: dict = {"employee_decision": decision, "updated_at": decision["at"]}
    if payload.accepted:
        patch["agreed_rate"] = doc["proposed_rate"]
        patch["status"] = "accepte"
        await db.employee_profiles.update_one(
            {"pharmacy_id": doc["pharmacy_id"], "employee_id": doc["employee_id"]},
            {"$set": {"hourly_rate": doc["proposed_rate"]}},
        )
    else:
        patch["status"] = "refuse"
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": patch})
    await log_audit(
        user["email"], user["role"],
        "SALAIRE_ACCEPTE" if payload.accepted else "SALAIRE_REFUSE",
        "évaluation", evaluation_id,
        f"{doc['employee_name']} a {'accepté' if payload.accepted else 'refusé'} le taux de {doc['proposed_rate']} $/h"
        + (f" — {decision['comment']}" if decision["comment"] else ""), doc["pharmacy_id"],
    )
    return {**doc, **patch}


@router.post("/{evaluation_id}/applied")
async def mark_evaluation_applied(evaluation_id: str, principal: dict = Depends(get_principal)):
    doc = await get_evaluation_or_404(evaluation_id)
    if doc["status"] != "accepte":
        raise HTTPException(status_code=400, detail="Le salaire doit d'abord être accepté par l'employé.")
    await db.evaluations.update_one({"id": evaluation_id}, {"$set": {
        "applied": True, "status": "applique", "updated_at": datetime.now(timezone.utc).isoformat(),
    }})
    await log_audit(
        principal["email"], principal["role"], "SALAIRE_APPLIQUE", "évaluation", evaluation_id,
        f"Nouveau taux de {doc['agreed_rate']} $/h appliqué au dossier de {doc['employee_name']}",
        doc["pharmacy_id"],
    )
    return {"status": "applique"}


@router.delete("/{evaluation_id}")
async def delete_evaluation(evaluation_id: str, principal: dict = Depends(get_principal)):
    doc = await get_evaluation_or_404(evaluation_id)
    await db.evaluations.delete_one({"id": evaluation_id})
    await log_audit(
        principal["email"], principal["role"], "SUPPRESSION_EVALUATION", "évaluation", evaluation_id,
        f"Évaluation de {doc['employee_name']} supprimée", doc["pharmacy_id"],
    )
    return {"status": "supprimée"}
