from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timedelta
from emergentintegrations.llm.chat import LlmChat, UserMessage
import json

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Gemini Configuration
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# ==================== MODELS ====================

class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    email: str
    phone: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class UserCreate(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None

class Transaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    amount: float
    category: str
    description: str
    date: datetime
    source: str  # "sms" or "manual"
    sentiment: Optional[str] = None  # "positive", "neutral", "negative"
    created_at: datetime = Field(default_factory=datetime.utcnow)

class TransactionCreate(BaseModel):
    user_id: str
    amount: float
    description: str
    date: Optional[datetime] = None

class SMSTransactionRequest(BaseModel):
    user_id: str
    sms_text: str
    date: Optional[datetime] = None

class Credit(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    credit_score: Optional[int] = None
    card_name: str
    card_balance: float
    credit_limit: float
    payment_due_date: Optional[datetime] = None
    utilization: float = 0.0
    created_at: datetime = Field(default_factory=datetime.utcnow)

class CreditCreate(BaseModel):
    user_id: str
    credit_score: Optional[int] = None
    card_name: str
    card_balance: float
    credit_limit: float
    payment_due_date: Optional[datetime] = None

class Habit(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    goal: str
    target_amount: float
    current_amount: float = 0.0
    category: str
    start_date: datetime = Field(default_factory=datetime.utcnow)
    end_date: Optional[datetime] = None
    status: str = "active"  # "active", "completed", "failed"
    progress: float = 0.0

class HabitCreate(BaseModel):
    user_id: str
    goal: str
    target_amount: float
    category: str
    end_date: Optional[datetime] = None

class ChatMessage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    role: str  # "user" or "assistant"
    message: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class ChatRequest(BaseModel):
    user_id: str
    message: str

# ==================== HELPER FUNCTIONS ====================

async def categorize_transaction_with_ai(text: str, amount: float) -> Dict[str, str]:
    """Use Gemini to categorize transaction and analyze sentiment"""
    try:
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"categorize_{uuid.uuid4()}",
            system_message="You are a financial assistant that categorizes transactions and analyzes spending sentiment. Return ONLY a JSON object with 'category' and 'sentiment' fields."
        ).with_model("gemini", "gemini-2.5-flash")
        
        prompt = f"""Analyze this transaction:
Amount: ${amount}
Description: {text}

Return ONLY a JSON object with:
- category: one of [Food, Transport, Shopping, Bills, Entertainment, Health, Education, Travel, Other]
- sentiment: one of [positive, neutral, negative] (negative for large/unnecessary expenses)

JSON:"""
        
        user_message = UserMessage(text=prompt)
        response = await chat.send_message(user_message)
        
        # Clean markdown wrappers and parse JSON
        cleaned_response = response.strip()
        # Remove markdown code blocks if present
        cleaned_response = cleaned_response.replace('```json', '').replace('```', '').strip()
        
        # Handle empty response
        if not cleaned_response:
            logging.warning("Empty response from AI categorization")
            return {"category": "Other", "sentiment": "neutral"}
        
        result = json.loads(cleaned_response)
        return result
    except Exception as e:
        logging.error(f"AI categorization error: {e}")
        # Fallback
        return {"category": "Other", "sentiment": "neutral"}

async def generate_insights(user_id: str) -> str:
    """Generate personalized insights using Gemini"""
    try:
        # Get user's recent transactions
        transactions = await db.transactions.find(
            {"user_id": user_id}
        ).sort("date", -1).limit(20).to_list(20)
        
        if not transactions:
            return "Start tracking your expenses to get personalized insights!"
        
        # Calculate stats
        total_spending = sum(t.get('amount', 0) for t in transactions)
        categories = {}
        for t in transactions:
            cat = t.get('category', 'Other')
            categories[cat] = categories.get(cat, 0) + t.get('amount', 0)
        
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"insights_{user_id}",
            system_message="You are a financial advisor providing brief, actionable insights about spending habits."
        ).with_model("gemini", "gemini-2.5-flash")
        
        prompt = f"""User's spending summary:
Total: ${total_spending:.2f}
Categories: {categories}

Provide 3 brief, actionable insights (max 50 words each) about their spending habits and suggestions to improve."""
        
        user_message = UserMessage(text=prompt)
        response = await chat.send_message(user_message)
        return response
    except Exception as e:
        logging.error(f"Insights generation error: {e}")
        return "Unable to generate insights at the moment."

# ==================== API ENDPOINTS ====================

@api_router.get("/")
async def root():
    return {"message": "Financial Habit Tracker API", "version": "1.0"}

# User endpoints
@api_router.post("/users", response_model=User)
async def create_user(user: UserCreate):
    user_obj = User(**user.dict())
    await db.users.insert_one(user_obj.dict())
    return user_obj

@api_router.get("/users/{user_id}", response_model=User)
async def get_user(user_id: str):
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return User(**user)

# Transaction endpoints
@api_router.post("/transactions/manual", response_model=Transaction)
async def create_manual_transaction(transaction: TransactionCreate):
    """Create a manual transaction with AI categorization"""
    # Categorize with AI
    ai_result = await categorize_transaction_with_ai(
        transaction.description,
        transaction.amount
    )
    
    trans_dict = transaction.dict()
    trans_dict['date'] = trans_dict.get('date') or datetime.utcnow()
    trans_dict['source'] = 'manual'
    trans_dict['category'] = ai_result.get('category', 'Other')
    trans_dict['sentiment'] = ai_result.get('sentiment', 'neutral')
    
    trans_obj = Transaction(**trans_dict)
    await db.transactions.insert_one(trans_obj.dict())
    
    # Update habit progress
    await update_habit_progress(trans_obj.user_id, trans_obj.category, trans_obj.amount)
    
    return trans_obj

@api_router.post("/transactions/sms", response_model=Transaction)
async def create_sms_transaction(request: SMSTransactionRequest):
    """Parse SMS and create transaction with AI"""
    # Extract amount from SMS (simple regex approach)
    import re
    
    # Try to extract amount
    amount_match = re.search(r'(?:Rs\.?|INR|USD|\$)\s*([0-9,]+\.?[0-9]*)', request.sms_text, re.IGNORECASE)
    if not amount_match:
        amount_match = re.search(r'([0-9,]+\.?[0-9]*)\s*(?:debited|spent|paid)', request.sms_text, re.IGNORECASE)
    
    if not amount_match:
        raise HTTPException(status_code=400, detail="Could not extract amount from SMS")
    
    amount_str = amount_match.group(1).replace(',', '')
    amount = float(amount_str)
    
    # Categorize with AI
    ai_result = await categorize_transaction_with_ai(request.sms_text, amount)
    
    trans_obj = Transaction(
        user_id=request.user_id,
        amount=amount,
        category=ai_result.get('category', 'Other'),
        description=request.sms_text[:100],
        date=request.date or datetime.utcnow(),
        source='sms',
        sentiment=ai_result.get('sentiment', 'neutral')
    )
    
    await db.transactions.insert_one(trans_obj.dict())
    
    # Update habit progress
    await update_habit_progress(trans_obj.user_id, trans_obj.category, trans_obj.amount)
    
    return trans_obj

@api_router.get("/transactions/{user_id}", response_model=List[Transaction])
async def get_user_transactions(user_id: str, limit: int = 50):
    transactions = await db.transactions.find(
        {"user_id": user_id}
    ).sort("date", -1).limit(limit).to_list(limit)
    return [Transaction(**t) for t in transactions]

@api_router.get("/transactions/{user_id}/analytics")
async def get_transaction_analytics(user_id: str, days: int = 30):
    """Get spending analytics"""
    start_date = datetime.utcnow() - timedelta(days=days)
    
    transactions = await db.transactions.find({
        "user_id": user_id,
        "date": {"$gte": start_date}
    }).to_list(1000)
    
    total_spending = sum(t.get('amount', 0) for t in transactions)
    
    # Category breakdown
    categories = {}
    for t in transactions:
        cat = t.get('category', 'Other')
        categories[cat] = categories.get(cat, 0) + t.get('amount', 0)
    
    # Daily spending
    daily_spending = {}
    for t in transactions:
        date_key = t.get('date', datetime.utcnow()).strftime('%Y-%m-%d')
        daily_spending[date_key] = daily_spending.get(date_key, 0) + t.get('amount', 0)
    
    # Sentiment analysis
    sentiment_counts = {"positive": 0, "neutral": 0, "negative": 0}
    for t in transactions:
        sent = t.get('sentiment', 'neutral')
        sentiment_counts[sent] = sentiment_counts.get(sent, 0) + 1
    
    return {
        "total_spending": total_spending,
        "transaction_count": len(transactions),
        "average_transaction": total_spending / len(transactions) if transactions else 0,
        "categories": categories,
        "daily_spending": daily_spending,
        "sentiment": sentiment_counts
    }

# Credit endpoints
@api_router.post("/credits", response_model=Credit)
async def create_credit(credit: CreditCreate):
    credit_dict = credit.dict()
    credit_dict['utilization'] = (credit_dict['card_balance'] / credit_dict['credit_limit'] * 100) if credit_dict['credit_limit'] > 0 else 0
    credit_obj = Credit(**credit_dict)
    await db.credits.insert_one(credit_obj.dict())
    return credit_obj

@api_router.get("/credits/{user_id}", response_model=List[Credit])
async def get_user_credits(user_id: str):
    credits = await db.credits.find({"user_id": user_id}).to_list(100)
    return [Credit(**c) for c in credits]

@api_router.put("/credits/{credit_id}", response_model=Credit)
async def update_credit(credit_id: str, credit: CreditCreate):
    credit_dict = credit.dict()
    credit_dict['utilization'] = (credit_dict['card_balance'] / credit_dict['credit_limit'] * 100) if credit_dict['credit_limit'] > 0 else 0
    
    await db.credits.update_one(
        {"id": credit_id},
        {"$set": credit_dict}
    )
    
    updated_credit = await db.credits.find_one({"id": credit_id})
    if not updated_credit:
        raise HTTPException(status_code=404, detail="Credit not found")
    return Credit(**updated_credit)

# Habit endpoints
@api_router.post("/habits", response_model=Habit)
async def create_habit(habit: HabitCreate):
    habit_obj = Habit(**habit.dict())
    await db.habits.insert_one(habit_obj.dict())
    return habit_obj

@api_router.get("/habits/{user_id}", response_model=List[Habit])
async def get_user_habits(user_id: str):
    habits = await db.habits.find({"user_id": user_id}).to_list(100)
    return [Habit(**h) for h in habits]

async def update_habit_progress(user_id: str, category: str, amount: float):
    """Update habit progress when transaction is added"""
    habits = await db.habits.find({
        "user_id": user_id,
        "category": category,
        "status": "active"
    }).to_list(100)
    
    for habit in habits:
        new_amount = habit.get('current_amount', 0) + amount
        progress = (new_amount / habit.get('target_amount', 1)) * 100
        
        status = "active"
        if progress >= 100:
            status = "completed"
        
        await db.habits.update_one(
            {"id": habit['id']},
            {"$set": {
                "current_amount": new_amount,
                "progress": min(progress, 100),
                "status": status
            }}
        )

# Chat endpoints
@api_router.post("/chat")
async def chat_with_ai(request: ChatRequest):
    """Chat with AI financial advisor"""
    try:
        # Save user message
        user_msg = ChatMessage(
            user_id=request.user_id,
            role="user",
            message=request.message
        )
        await db.chat_messages.insert_one(user_msg.dict())
        
        # Get user's financial context
        transactions = await db.transactions.find(
            {"user_id": request.user_id}
        ).sort("date", -1).limit(10).to_list(10)
        
        total_spending = sum(t.get('amount', 0) for t in transactions)
        
        # Get recent conversation history
        recent_messages = await db.chat_messages.find(
            {"user_id": request.user_id}
        ).sort("timestamp", -1).limit(5).to_list(5)
        recent_messages.reverse()
        
        context = f"User's recent spending: ${total_spending:.2f} across {len(transactions)} transactions."
        
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=request.user_id,
            system_message=f"You are a helpful financial advisor. Provide concise, practical advice. {context}"
        ).with_model("gemini", "gemini-2.5-flash")
        
        user_message = UserMessage(text=request.message)
        response = await chat.send_message(user_message)
        
        # Save assistant message
        assistant_msg = ChatMessage(
            user_id=request.user_id,
            role="assistant",
            message=response
        )
        await db.chat_messages.insert_one(assistant_msg.dict())
        
        return {"response": response}
    except Exception as e:
        logging.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/chat/{user_id}", response_model=List[ChatMessage])
async def get_chat_history(user_id: str, limit: int = 50):
    messages = await db.chat_messages.find(
        {"user_id": user_id}
    ).sort("timestamp", -1).limit(limit).to_list(limit)
    messages.reverse()
    return [ChatMessage(**m) for m in messages]

@api_router.get("/insights/{user_id}")
async def get_ai_insights(user_id: str):
    """Get AI-generated insights"""
    insights = await generate_insights(user_id)
    return {"insights": insights}

# Include router
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()