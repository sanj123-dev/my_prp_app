# SpendWise - AI-Powered Financial Habit Tracker

A comprehensive mobile application for tracking spending habits, managing credit, and receiving AI-powered financial insights.

## 🌟 Features

### Core Functionality
- **User Management**: Simple onboarding with name and email
- **Transaction Tracking**: 
  - Manual entry with AI-powered categorization
  - SMS reading for automatic transaction capture (Android)
  - Real-time sentiment analysis on spending
  
### Financial Management
- **Credit Card Tracking**:
  - Monitor multiple credit cards
  - Track credit scores
  - Real-time credit utilization calculation
  - Payment due date reminders
  
- **Analytics Dashboard**:
  - Total spending overview
  - Category-wise breakdown
  - Daily spending trends
  - Transaction count and averages
  - Sentiment analysis visualization

### AI-Powered Features
- **Smart Categorization**: Transactions automatically categorized into:
  - Food, Transport, Shopping, Bills
  - Entertainment, Health, Education, Travel, Other
  
- **AI Financial Advisor**:
  - Real-time chat with Google Gemini AI
  - Personalized financial advice
  - Spending pattern analysis
  - Budget recommendations
  
- **Sentiment Analysis**:
  - Positive, neutral, or negative spending sentiment
  - Helps identify emotional spending triggers
  
- **AI Insights**:
  - Personalized spending insights
  - Actionable recommendations
  - Habit formation suggestions

## 🛠️ Technology Stack

### Frontend (React Native/Expo)
- **Framework**: Expo Router (File-based routing)
- **UI Components**: React Native
- **Navigation**: React Navigation (Tab-based)
- **State Management**: AsyncStorage, React Hooks
- **Charts**: react-native-gifted-charts
- **HTTP Client**: Axios
- **Icons**: Expo Vector Icons
- **Date Handling**: date-fns

### Backend (Python/FastAPI)
- **Framework**: FastAPI
- **Database**: MongoDB (Motor async driver)
- **AI Integration**: Google Gemini 2.5 Flash
- **LLM Library**: emergentintegrations
- **API Key**: Emergent Universal LLM Key

## 📱 App Structure

```
SpendWise/
├── Dashboard          # Overview, analytics, AI insights
├── Transactions       # View, add, categorize transactions
├── Credit            # Manage credit cards and utilization
├── AI Chat           # Conversational financial advisor
└── Profile           # Settings and user management
```

## 🚀 Key Features

### 1. AI Transaction Categorization
- Automatically categorizes spending using Google Gemini AI
- Analyzes transaction description and amount
- Assigns appropriate category (Food, Transport, etc.)

### 2. SMS Auto-Import (Android)
- Reads transaction SMS messages
- Extracts amount and details
- AI categorization applied automatically

### 3. AI Financial Advisor Chat
- Conversational interface powered by Gemini
- Context-aware responses based on spending history
- Personalized financial advice

### 4. Credit Utilization Tracking
- Automatic calculation of credit utilization %
- Color-coded warnings (green < 30%, yellow < 70%, red > 70%)
- Multiple credit card support

### 5. Sentiment Analysis
- Analyzes emotional patterns in spending
- Identifies triggers for overspending
- Helps build better financial habits

## 📊 API Endpoints

### Users
- `POST /api/users` - Create user
- `GET /api/users/{user_id}` - Get user details

### Transactions
- `POST /api/transactions/manual` - Add manual transaction (AI categorized)
- `POST /api/transactions/sms` - Parse SMS and create transaction
- `GET /api/transactions/{user_id}` - Get all transactions
- `GET /api/transactions/{user_id}/analytics` - Get spending analytics

### Credit
- `POST /api/credits` - Add credit card
- `GET /api/credits/{user_id}` - Get all credit cards
- `PUT /api/credits/{credit_id}` - Update credit card

### AI Features
- `POST /api/chat` - Chat with AI advisor
- `GET /api/chat/{user_id}` - Get chat history
- `GET /api/insights/{user_id}` - Get AI-generated insights

## 🤖 AI Integration

- **Provider**: Google Gemini
- **Model**: gemini-2.5-flash
- **Key**: Emergent Universal LLM Key
- **Use Cases**:
  1. Transaction categorization
  2. Sentiment analysis
  3. Financial advice chatbot
  4. Personalized insights generation

## 📲 Mobile Permissions

### Android
- READ_SMS - Read transaction messages
- RECEIVE_SMS - Detect new transactions

### iOS
- SMS reading not available (iOS limitation)
- Manual entry with AI categorization available

## 🎨 Design

- Modern dark theme (#0f0f1e background)
- Tab-based navigation for easy thumb access
- Touch-friendly buttons (44x44 minimum)
- Pull-to-refresh on all views
- Modal forms for quick actions
- Category color coding for visual clarity

## 🧪 Testing the Backend

```bash
# Health check
curl http://localhost:8001/api/

# Create user
curl -X POST http://localhost:8001/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe", "email": "john@example.com"}'

# Add transaction with AI categorization
curl -X POST http://localhost:8001/api/transactions/manual \
  -H "Content-Type: application/json" \
  -d '{"user_id": "xxx", "amount": 45.50, "description": "Lunch at restaurant"}'

# Parse SMS transaction
curl -X POST http://localhost:8001/api/transactions/sms \
  -H "Content-Type: application/json" \
  -d '{"user_id": "xxx", "sms_text": "Your account debited Rs. 1250 for AMAZON purchase"}'

# Get analytics
curl http://localhost:8001/api/transactions/{user_id}/analytics?days=30

# Chat with AI
curl -X POST http://localhost:8001/api/chat \
  -H "Content-Type: application/json" \
  -d '{"user_id": "xxx", "message": "How can I save money?"}'

# Get AI insights
curl http://localhost:8001/api/insights/{user_id}
```

## 📝 Environment Setup

### Backend (.env)
```
MONGO_URL=mongodb://localhost:27017
DB_NAME=test_database
EMERGENT_LLM_KEY=sk-emergent-xxxx
```

### Frontend (.env)
```
EXPO_PUBLIC_BACKEND_URL=https://your-domain.com
```

## 🚀 Running the App

1. **Start Backend**: Already running on port 8001
2. **Start Frontend**: Already running on port 3000
3. **Access App**: 
   - Mobile: Scan QR code with Expo Go
   - Web: Open browser to localhost:3000

## 🎯 Key Achievements

✅ AI-powered transaction categorization using Google Gemini
✅ Real-time sentiment analysis on spending
✅ Conversational AI financial advisor with context
✅ SMS auto-import for Android devices
✅ Credit utilization tracking with smart alerts
✅ Comprehensive analytics dashboard
✅ Modern, intuitive mobile-first UI
✅ Cross-platform compatibility (iOS & Android)
✅ Secure data handling with MongoDB
✅ RESTful API architecture

## 🔮 Future Enhancements

- [ ] Savings goals with progress tracking
- [ ] Budget setting and alerts
- [ ] Bill payment reminders
- [ ] Receipt photo scanning (OCR)
- [ ] Bank account integration
- [ ] Investment tracking
- [ ] Predictive spending forecasts
- [ ] Habit streaks and gamification

---

**Built with ❤️ using Expo, FastAPI, MongoDB, and Google Gemini AI**
