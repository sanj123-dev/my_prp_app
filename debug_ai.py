#!/usr/bin/env python3
"""
Debug AI categorization to see what's being returned
"""

import requests
import json

BACKEND_URL = "https://spendwise-1371.preview.emergentagent.com/api"

# Create a test user first
user_data = {
    "name": "Debug User",
    "email": "debug@example.com"
}

response = requests.post(f"{BACKEND_URL}/users", json=user_data)
if response.status_code == 200:
    user_id = response.json()['id']
    print(f"Created test user: {user_id}")
    
    # Test transaction with detailed logging
    transaction_data = {
        "user_id": user_id,
        "amount": 15.50,
        "description": "Dinner at McDonald's"
    }
    
    print(f"Testing transaction: {transaction_data}")
    response = requests.post(f"{BACKEND_URL}/transactions/manual", json=transaction_data)
    
    print(f"Response status: {response.status_code}")
    print(f"Response body: {response.text}")
    
    if response.status_code == 200:
        data = response.json()
        print(f"Category: {data.get('category')}")
        print(f"Sentiment: {data.get('sentiment')}")
else:
    print(f"Failed to create user: {response.text}")