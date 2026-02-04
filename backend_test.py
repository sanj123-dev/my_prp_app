#!/usr/bin/env python3
"""
SpendWise Financial Habit Tracker Backend API Test Suite
Tests all backend endpoints comprehensively
"""

import requests
import json
import time
from datetime import datetime, timedelta
from typing import Dict, Any

# Backend URL from frontend .env
BACKEND_URL = "https://spendwise-1371.preview.emergentagent.com/api"

class SpendWiseAPITester:
    def __init__(self):
        self.base_url = BACKEND_URL
        self.test_user_id = None
        self.test_results = []
        
    def log_test(self, test_name: str, success: bool, details: str = "", response_time: float = 0):
        """Log test results"""
        status = "✅ PASS" if success else "❌ FAIL"
        result = {
            "test": test_name,
            "status": status,
            "success": success,
            "details": details,
            "response_time": f"{response_time:.2f}s"
        }
        self.test_results.append(result)
        print(f"{status} {test_name} ({response_time:.2f}s)")
        if details:
            print(f"    Details: {details}")
        print()

    def test_api_health(self):
        """Test if API is accessible"""
        try:
            start_time = time.time()
            response = requests.get(f"{self.base_url}/", timeout=10)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                self.log_test("API Health Check", True, 
                            f"API accessible, message: {data.get('message', 'N/A')}", response_time)
                return True
            else:
                self.log_test("API Health Check", False, 
                            f"Status: {response.status_code}, Response: {response.text}", response_time)
                return False
        except Exception as e:
            self.log_test("API Health Check", False, f"Connection error: {str(e)}")
            return False

    def test_user_creation(self):
        """Test user creation with valid data"""
        try:
            start_time = time.time()
            user_data = {
                "name": "Sarah Johnson",
                "email": "sarah.johnson@example.com",
                "phone": "+1234567890"
            }
            
            response = requests.post(f"{self.base_url}/users", 
                                   json=user_data, timeout=10)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ['id', 'name', 'email']
                
                if all(field in data for field in required_fields):
                    self.test_user_id = data['id']
                    self.log_test("User Creation", True, 
                                f"User created with ID: {self.test_user_id}", response_time)
                    return True
                else:
                    missing = [f for f in required_fields if f not in data]
                    self.log_test("User Creation", False, 
                                f"Missing fields: {missing}", response_time)
                    return False
            else:
                self.log_test("User Creation", False, 
                            f"Status: {response.status_code}, Response: {response.text}", response_time)
                return False
        except Exception as e:
            self.log_test("User Creation", False, f"Error: {str(e)}")
            return False

    def test_manual_transaction_ai_categorization(self):
        """Test manual transaction creation with AI categorization"""
        if not self.test_user_id:
            self.log_test("Manual Transaction AI", False, "No test user available")
            return False
            
        test_cases = [
            {"description": "Dinner at McDonald's", "amount": 15.50, "expected_category": "Food"},
            {"description": "Lunch at restaurant", "amount": 25.00, "expected_category": "Food"},
            {"description": "Uber ride to office", "amount": 12.75, "expected_category": "Transport"},
            {"description": "Amazon purchase", "amount": 89.99, "expected_category": "Shopping"},
            {"description": "Electric bill payment", "amount": 125.00, "expected_category": "Bills"}
        ]
        
        all_passed = True
        for i, case in enumerate(test_cases):
            try:
                start_time = time.time()
                transaction_data = {
                    "user_id": self.test_user_id,
                    "amount": case["amount"],
                    "description": case["description"]
                }
                
                response = requests.post(f"{self.base_url}/transactions/manual", 
                                       json=transaction_data, timeout=15)
                response_time = time.time() - start_time
                
                if response.status_code == 200:
                    data = response.json()
                    category = data.get('category', 'Unknown')
                    sentiment = data.get('sentiment', 'Unknown')
                    
                    # Check if AI categorization worked (not just "Other")
                    ai_working = category != "Other" and category != "Unknown"
                    
                    if ai_working:
                        self.log_test(f"Manual Transaction AI #{i+1}", True, 
                                    f"Description: '{case['description']}' → Category: {category}, Sentiment: {sentiment}", 
                                    response_time)
                    else:
                        self.log_test(f"Manual Transaction AI #{i+1}", False, 
                                    f"AI returned generic category '{category}' for '{case['description']}'", 
                                    response_time)
                        all_passed = False
                else:
                    self.log_test(f"Manual Transaction AI #{i+1}", False, 
                                f"Status: {response.status_code}, Response: {response.text}", response_time)
                    all_passed = False
                    
            except Exception as e:
                self.log_test(f"Manual Transaction AI #{i+1}", False, f"Error: {str(e)}")
                all_passed = False
                
        return all_passed

    def test_sms_transaction_parsing(self):
        """Test SMS transaction parsing with various formats"""
        if not self.test_user_id:
            self.log_test("SMS Transaction Parsing", False, "No test user available")
            return False
            
        sms_test_cases = [
            "Your account debited Rs. 500 for purchase at Walmart",
            "Amount USD 125.50 spent at Starbucks",
            "Paid $45 to Netflix subscription"
        ]
        
        all_passed = True
        for i, sms_text in enumerate(sms_test_cases):
            try:
                start_time = time.time()
                sms_data = {
                    "user_id": self.test_user_id,
                    "sms_text": sms_text
                }
                
                response = requests.post(f"{self.base_url}/transactions/sms", 
                                       json=sms_data, timeout=15)
                response_time = time.time() - start_time
                
                if response.status_code == 200:
                    data = response.json()
                    amount = data.get('amount', 0)
                    category = data.get('category', 'Unknown')
                    
                    if amount > 0 and category != "Unknown":
                        self.log_test(f"SMS Parsing #{i+1}", True, 
                                    f"SMS: '{sms_text}' → Amount: ${amount}, Category: {category}", 
                                    response_time)
                    else:
                        self.log_test(f"SMS Parsing #{i+1}", False, 
                                    f"Failed to extract amount or category from '{sms_text}'", 
                                    response_time)
                        all_passed = False
                else:
                    self.log_test(f"SMS Parsing #{i+1}", False, 
                                f"Status: {response.status_code}, Response: {response.text}", response_time)
                    all_passed = False
                    
            except Exception as e:
                self.log_test(f"SMS Parsing #{i+1}", False, f"Error: {str(e)}")
                all_passed = False
                
        return all_passed

    def test_transaction_analytics(self):
        """Test transaction analytics calculation"""
        if not self.test_user_id:
            self.log_test("Transaction Analytics", False, "No test user available")
            return False
            
        try:
            start_time = time.time()
            response = requests.get(f"{self.base_url}/transactions/{self.test_user_id}/analytics", 
                                  timeout=10)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ['total_spending', 'transaction_count', 'average_transaction', 
                                 'categories', 'sentiment']
                
                if all(field in data for field in required_fields):
                    total = data['total_spending']
                    count = data['transaction_count']
                    avg = data['average_transaction']
                    categories = data['categories']
                    sentiment = data['sentiment']
                    
                    # Verify calculations make sense
                    calc_correct = (count == 0 and avg == 0) or (abs(avg - (total / count)) < 0.01)
                    
                    if calc_correct:
                        self.log_test("Transaction Analytics", True, 
                                    f"Total: ${total:.2f}, Count: {count}, Avg: ${avg:.2f}, Categories: {len(categories)}", 
                                    response_time)
                        return True
                    else:
                        self.log_test("Transaction Analytics", False, 
                                    f"Calculation error: Total=${total}, Count={count}, Avg=${avg}", 
                                    response_time)
                        return False
                else:
                    missing = [f for f in required_fields if f not in data]
                    self.log_test("Transaction Analytics", False, 
                                f"Missing fields: {missing}", response_time)
                    return False
            else:
                self.log_test("Transaction Analytics", False, 
                            f"Status: {response.status_code}, Response: {response.text}", response_time)
                return False
        except Exception as e:
            self.log_test("Transaction Analytics", False, f"Error: {str(e)}")
            return False

    def test_credit_card_management(self):
        """Test credit card creation and utilization calculation"""
        if not self.test_user_id:
            self.log_test("Credit Card Management", False, "No test user available")
            return False
            
        test_cases = [
            {"card_name": "Chase Sapphire", "balance": 1000, "limit": 10000, "expected_util": 10.0},
            {"card_name": "Capital One", "balance": 7500, "limit": 10000, "expected_util": 75.0}
        ]
        
        all_passed = True
        for i, case in enumerate(test_cases):
            try:
                start_time = time.time()
                credit_data = {
                    "user_id": self.test_user_id,
                    "card_name": case["card_name"],
                    "card_balance": case["balance"],
                    "credit_limit": case["limit"]
                }
                
                response = requests.post(f"{self.base_url}/credits", 
                                       json=credit_data, timeout=10)
                response_time = time.time() - start_time
                
                if response.status_code == 200:
                    data = response.json()
                    utilization = data.get('utilization', 0)
                    
                    if abs(utilization - case["expected_util"]) < 0.1:
                        self.log_test(f"Credit Card #{i+1}", True, 
                                    f"{case['card_name']}: ${case['balance']}/${case['limit']} = {utilization:.1f}%", 
                                    response_time)
                    else:
                        self.log_test(f"Credit Card #{i+1}", False, 
                                    f"Utilization calculation error: Expected {case['expected_util']}%, Got {utilization}%", 
                                    response_time)
                        all_passed = False
                else:
                    self.log_test(f"Credit Card #{i+1}", False, 
                                f"Status: {response.status_code}, Response: {response.text}", response_time)
                    all_passed = False
                    
            except Exception as e:
                self.log_test(f"Credit Card #{i+1}", False, f"Error: {str(e)}")
                all_passed = False
                
        return all_passed

    def test_ai_chatbot(self):
        """Test AI chatbot functionality"""
        if not self.test_user_id:
            self.log_test("AI Chatbot", False, "No test user available")
            return False
            
        test_messages = [
            "How can I reduce my spending?",
            "What's my biggest expense category?",
            "Give me tips for saving money"
        ]
        
        all_passed = True
        for i, message in enumerate(test_messages):
            try:
                start_time = time.time()
                chat_data = {
                    "user_id": self.test_user_id,
                    "message": message
                }
                
                response = requests.post(f"{self.base_url}/chat", 
                                       json=chat_data, timeout=20)
                response_time = time.time() - start_time
                
                if response.status_code == 200:
                    data = response.json()
                    ai_response = data.get('response', '')
                    
                    # Check if response is meaningful (not empty or error)
                    if len(ai_response) > 10 and "error" not in ai_response.lower():
                        self.log_test(f"AI Chatbot #{i+1}", True, 
                                    f"Message: '{message}' → Response length: {len(ai_response)} chars", 
                                    response_time)
                    else:
                        self.log_test(f"AI Chatbot #{i+1}", False, 
                                    f"Poor AI response: '{ai_response[:100]}...'", response_time)
                        all_passed = False
                else:
                    self.log_test(f"AI Chatbot #{i+1}", False, 
                                f"Status: {response.status_code}, Response: {response.text}", response_time)
                    all_passed = False
                    
            except Exception as e:
                self.log_test(f"AI Chatbot #{i+1}", False, f"Error: {str(e)}")
                all_passed = False
                
        return all_passed

    def test_ai_insights(self):
        """Test AI insights generation"""
        if not self.test_user_id:
            self.log_test("AI Insights", False, "No test user available")
            return False
            
        try:
            start_time = time.time()
            response = requests.get(f"{self.base_url}/insights/{self.test_user_id}", 
                                  timeout=20)
            response_time = time.time() - start_time
            
            if response.status_code == 200:
                data = response.json()
                insights = data.get('insights', '')
                
                # Check if insights are meaningful
                if len(insights) > 20 and "unable" not in insights.lower():
                    self.log_test("AI Insights", True, 
                                f"Generated insights: {len(insights)} chars", response_time)
                    return True
                else:
                    self.log_test("AI Insights", False, 
                                f"Poor insights: '{insights[:100]}...'", response_time)
                    return False
            else:
                self.log_test("AI Insights", False, 
                            f"Status: {response.status_code}, Response: {response.text}", response_time)
                return False
        except Exception as e:
            self.log_test("AI Insights", False, f"Error: {str(e)}")
            return False

    def run_all_tests(self):
        """Run all tests in sequence"""
        print("🚀 Starting SpendWise Backend API Tests")
        print(f"Backend URL: {self.base_url}")
        print("=" * 60)
        
        # Test API health first
        if not self.test_api_health():
            print("❌ API is not accessible. Stopping tests.")
            return
            
        # Run all tests
        self.test_user_creation()
        self.test_manual_transaction_ai_categorization()
        self.test_sms_transaction_parsing()
        self.test_transaction_analytics()
        self.test_credit_card_management()
        self.test_ai_chatbot()
        self.test_ai_insights()
        
        # Summary
        print("=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for r in self.test_results if r['success'])
        total = len(self.test_results)
        
        for result in self.test_results:
            print(f"{result['status']} {result['test']} ({result['response_time']})")
            
        print(f"\n🎯 Overall: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
        
        # Critical issues
        failed_tests = [r for r in self.test_results if not r['success']]
        if failed_tests:
            print("\n🚨 CRITICAL ISSUES:")
            for test in failed_tests:
                print(f"   • {test['test']}: {test['details']}")

if __name__ == "__main__":
    tester = SpendWiseAPITester()
    tester.run_all_tests()