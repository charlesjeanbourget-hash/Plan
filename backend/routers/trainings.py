"""Formations — extraits de server.py. Génération IA et upload PDF restent dans le monolithe."""
import uuid
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core.config import db
from core.security import get_current_user, get_principal, log_audit, scoped_pid

router = APIRouter(prefix="/trainings", tags=["trainings"])


def training_public(doc: dict, include_answers: bool) -> dict:
    d = {k: v for k, v in doc.items() if k not in ("_id", "storage_path")}
    if not include_answers:
        d["exam"] = [
            {"id": q["id"], "question": q["question"], "options": q["options"]}
            for q in d.get("exam") or []
        ]
    return d


async def get_training_or_404(training_id: str, user: dict) -> dict:
    doc = await db.trainings.find_one({"id": training_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Formation introuvable.")
    if user["role"] != "superadmin" and (user.get("pharmacy_id") or "") != doc["pharmacy_id"]:
        raise HTTPException(status_code=404, detail="Formation introuvable.")
    if user["role"] == "employee" and doc["status"] != "published":
        raise HTTPException(status_code=404, detail="Formation introuvable.")
    return doc


class TrainingSectionIn(BaseModel):
    id: Optional[str] = None
    sector: str
    title: str
    content: str
    key_points: list[str] = []


class ExamQuestionIn(BaseModel):
    id: Optional[str] = None
    question: str
    options: list[str]
    correct_index: int
    explanation: str = ""


class TrainingUpdateIn(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    sections: Optional[list[TrainingSectionIn]] = None
    exam: Optional[list[ExamQuestionIn]] = None
    passing_score: Optional[int] = None
    status: Optional[str] = None


class AttemptIn(BaseModel):
    answers: list[int]


class AssignmentIn(BaseModel):
    employee_email: str
    employee_name: str
    due_date: str


class AssignmentsIn(BaseModel):
    assignments: list[AssignmentIn]


@router.get("")
async def list_trainings(pharmacy_id: Optional[str] = Query(None), user: dict = Depends(get_current_user)):
    if user["role"] == "superadmin":
        query: dict = {"pharmacy_id": scoped_pid(user)}
    elif user["role"] == "admin":
        if not user.get("pharmacy_id"):
            raise HTTPException(status_code=403, detail="Aucune pharmacie associée à ce compte.")
        query = {"pharmacy_id": user["pharmacy_id"]}
    else:
        query = {"pharmacy_id": user.get("pharmacy_id") or "", "status": "published"}
    docs = await db.trainings.find(query, {"_id": 0}).sort("created_at", -1).to_list(500)
    include_answers = user["role"] in ("admin", "manager", "superadmin")
    out = []
    for d in docs:
        item = training_public(d, include_answers)
        if user["role"] == "employee":
            attempts = await db.training_attempts.find(
                {"training_id": d["id"], "user_id": user["id"]}, {"_id": 0, "score": 1, "passed": 1}
            ).to_list(200)
            item["my_attempts"] = len(attempts)
            item["my_best_score"] = max((a["score"] for a in attempts), default=None)
            item["my_passed"] = any(a["passed"] for a in attempts)
            item["my_assignment"] = await db.training_assignments.find_one(
                {"training_id": d["id"], "employee_email": user["email"]}, {"_id": 0, "due_date": 1}
            )
        out.append(item)
    return out


@router.get("/{training_id}")
async def get_training(training_id: str, user: dict = Depends(get_current_user)):
    doc = await get_training_or_404(training_id, user)
    return training_public(doc, user["role"] in ("admin", "manager", "superadmin"))


@router.put("/{training_id}")
async def update_training(training_id: str, payload: TrainingUpdateIn, principal: dict = Depends(get_principal)):
    user = {"role": principal["role"], "pharmacy_id": principal["pharmacy_id"]}
    doc = await get_training_or_404(training_id, user)
    patch: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.title is not None:
        patch["title"] = payload.title.strip()
    if payload.category is not None:
        patch["category"] = payload.category.strip() or "Formation continue"
    if payload.passing_score is not None:
        if not (0 < payload.passing_score <= 100):
            raise HTTPException(status_code=400, detail="Note de passage invalide (1 à 100).")
        patch["passing_score"] = payload.passing_score
    if payload.sections is not None:
        patch["sections"] = [
            {"id": s.id or str(uuid.uuid4()), "sector": s.sector, "title": s.title,
             "content": s.content, "key_points": s.key_points}
            for s in payload.sections
        ]
    if payload.exam is not None:
        for q in payload.exam:
            if len(q.options) < 2 or not (0 <= q.correct_index < len(q.options)):
                raise HTTPException(status_code=400, detail="Question d'examen invalide.")
        patch["exam"] = [
            {"id": q.id or str(uuid.uuid4()), "question": q.question, "options": q.options,
             "correct_index": q.correct_index, "explanation": q.explanation}
            for q in payload.exam
        ]
    if payload.status is not None:
        if payload.status not in ("draft", "published"):
            raise HTTPException(status_code=400, detail="Statut invalide.")
        if doc["status"] in ("processing",):
            raise HTTPException(status_code=400, detail="La formation est encore en préparation par l'IA.")
        patch["status"] = payload.status
        if payload.status == "published":
            if not (patch.get("sections") or doc.get("sections")) or not (patch.get("exam") or doc.get("exam")):
                raise HTTPException(status_code=400, detail="Impossible de publier sans sections ni examen.")
            patch["published_at"] = datetime.now(timezone.utc).isoformat()
            patch["error"] = None
    await db.trainings.update_one({"id": training_id}, {"$set": patch})
    action = "PUBLICATION_FORMATION" if payload.status == "published" else "MODIFICATION_FORMATION"
    await log_audit(
        principal["email"], principal["role"], action, "formation", training_id,
        f"Formation « {patch.get('title', doc['title'])} » — champs : {', '.join(k for k in patch if k != 'updated_at')}",
        doc["pharmacy_id"],
    )
    return training_public({**doc, **patch}, True)


@router.delete("/{training_id}")
async def delete_training(training_id: str, principal: dict = Depends(get_principal)):
    user = {"role": principal["role"], "pharmacy_id": principal["pharmacy_id"]}
    doc = await get_training_or_404(training_id, user)
    await db.trainings.delete_one({"id": training_id})
    await db.training_attempts.delete_many({"training_id": training_id})
    await log_audit(
        principal["email"], principal["role"], "SUPPRESSION_FORMATION", "formation", training_id,
        f"Formation « {doc['title']} » et ses résultats supprimés", doc["pharmacy_id"],
    )
    return {"status": "supprimée"}


@router.post("/{training_id}/attempts")
async def submit_attempt(training_id: str, payload: AttemptIn, user: dict = Depends(get_current_user)):
    doc = await get_training_or_404(training_id, user)
    exam = doc.get("exam") or []
    if not exam:
        raise HTTPException(status_code=400, detail="Cette formation n'a pas encore d'examen.")
    if len(payload.answers) != len(exam):
        raise HTTPException(status_code=400, detail="Veuillez répondre à toutes les questions.")
    correct = sum(1 for a, q in zip(payload.answers, exam) if a == q["correct_index"])
    score = round(correct / len(exam) * 100)
    passing = doc.get("passing_score", 80)
    passed = score >= passing
    attempt = {
        "id": str(uuid.uuid4()), "training_id": training_id, "pharmacy_id": doc["pharmacy_id"],
        "user_id": user["id"], "user_email": user["email"], "user_name": user["name"],
        "answers": payload.answers, "score": score, "passed": passed,
        "correct_count": correct, "total": len(exam),
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.training_attempts.insert_one(attempt)
    await log_audit(
        user["email"], user["role"], "TENTATIVE_EXAMEN", "formation", training_id,
        f"Examen « {doc['title']} » : {score} % ({'réussi' if passed else 'échoué'})", doc["pharmacy_id"],
    )
    return {
        "score": score, "passed": passed, "correct_count": correct, "total": len(exam),
        "passing_score": passing,
        "results": [
            {"question_id": q["id"], "your_answer": a, "correct": a == q["correct_index"],
             "correct_index": q["correct_index"], "explanation": q.get("explanation", "")}
            for a, q in zip(payload.answers, exam)
        ],
    }


@router.get("/{training_id}/attempts")
async def list_attempts(training_id: str, user: dict = Depends(get_current_user)):
    await get_training_or_404(training_id, user)
    if user["role"] in ("admin", "manager", "superadmin"):
        query: dict = {"training_id": training_id}
    else:
        query = {"training_id": training_id, "user_id": user["id"]}
    return await db.training_attempts.find(query, {"_id": 0, "answers": 0}).sort("completed_at", -1).to_list(1000)


@router.get("/{training_id}/assignments")
async def list_training_assignments(training_id: str, principal: dict = Depends(get_principal)):
    user = {"role": principal["role"], "pharmacy_id": principal["pharmacy_id"]}
    await get_training_or_404(training_id, user)
    assigns = await db.training_assignments.find({"training_id": training_id}, {"_id": 0}).sort("due_date", 1).to_list(1000)
    today = date.today().isoformat()
    for a in assigns:
        best = await db.training_attempts.find_one(
            {"training_id": training_id, "user_email": a["employee_email"], "passed": True},
            {"_id": 0, "score": 1, "completed_at": 1}, sort=[("score", -1)],
        )
        a["passed"] = best is not None
        a["passed_score"] = best["score"] if best else None
        a["overdue"] = (best is None) and a["due_date"] < today
    return assigns


@router.post("/{training_id}/assignments")
async def assign_training(training_id: str, payload: AssignmentsIn, principal: dict = Depends(get_principal)):
    user = {"role": principal["role"], "pharmacy_id": principal["pharmacy_id"]}
    doc = await get_training_or_404(training_id, user)
    now = datetime.now(timezone.utc).isoformat()
    count = 0
    for a in payload.assignments:
        email = a.employee_email.strip().lower()
        if not email or not a.due_date:
            continue
        rec = {
            "id": str(uuid.uuid4()), "training_id": training_id, "pharmacy_id": doc["pharmacy_id"],
            "employee_email": email, "employee_name": a.employee_name.strip()[:80],
            "due_date": a.due_date, "assigned_by": principal["email"], "assigned_at": now,
        }
        await db.training_assignments.update_one(
            {"training_id": training_id, "employee_email": email}, {"$set": rec}, upsert=True
        )
        count += 1
    await log_audit(
        principal["email"], principal["role"], "ASSIGNATION_FORMATION", "formation", training_id,
        f"{count} assignation(s) sur « {doc['title']} »", doc["pharmacy_id"],
    )
    return {"assigned": count}
