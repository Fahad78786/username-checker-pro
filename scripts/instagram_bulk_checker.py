#!/usr/bin/env python
# -*- coding: utf-8 -*-

import requests
import json
import random
import os
import sys
from typing import List, Dict, Any

# ✅ Path set karo
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
USERNAME_FILE = os.path.join(BASE_DIR, 'temp', 'bulk_usernames.txt')

def read_usernames() -> List[str]:
    with open(USERNAME_FILE, 'r', encoding='UTF-8') as f:
        return [line.strip() for line in f if line.strip()]

class InstagramBulkChecker:
    def __init__(self):
        self._samsung_ua = "Instagram 361.0.0.0.84 Android (28/9; 480dpi; 1080x1920; samsung; SM-G930F; herolte; samsungexynos8890; en_US; 673256705)"
        self._timeout = 15
        
        # ✅ Webshare Proxies
        self._proxies = [
            'http://mtqroiwi-gb-1:dy77ui0vm9rk@p.webshare.io:80',
            'http://mtqroiwi-ca-2:dy77ui0vm9rk@p.webshare.io:80',
            'http://mtqroiwi-de-3:dy77ui0vm9rk@p.webshare.io:80',
            'http://mtqroiwi-fr-4:dy77ui0vm9rk@p.webshare.io:80',
            'http://mtqroiwi-au-5:dy77ui0vm9rk@p.webshare.io:80',
            'http://mtqroiwi-nl-6:dy77ui0vm9rk@p.webshare.io:80',
            'http://mtqroiwi-it-7:dy77ui0vm9rk@p.webshare.io:80',
            'http://mtqroiwi-es-8:dy77ui0vm9rk@p.webshare.io:80',
            'http://mtqroiwi-be-9:dy77ui0vm9rk@p.webshare.io:80',
            'http://mtqroiwi-at-10:dy77ui0vm9rk@p.webshare.io:80',
        ]
    
    def _get_proxy(self):
        proxy = random.choice(self._proxies)
        return {"http": proxy, "https": proxy}
    
    def check_one(self, username: str) -> Dict[str, Any]:
        """Check single username"""
        headers = {
            "User-Agent": self._samsung_ua,
            "X-IG-App-ID": "936619743392459",
            "Accept": "*/*",
        }
        
        try:
            response = requests.get(
                f"https://i.instagram.com/api/v1/users/web_profile_info/?username={username}",
                headers=headers,
                proxies=self._get_proxy(),
                timeout=self._timeout
            )
            
            if response.status_code == 200:
                data = response.json()
                user = data.get('data', {}).get('user', {})
                if user:
                    return {
                        "success": True,
                        "username": user.get('username', username),
                        "full_name": user.get('full_name', ''),
                        "followers": user.get('edge_followed_by', {}).get('count', 0),
                        "following": user.get('edge_follow', {}).get('count', 0),
                        "is_private": user.get('is_private', False),
                        "is_verified": user.get('is_verified', False)
                    }
            
            if response.status_code == 404:
                return {"success": False, "username": username, "status": "Not Found"}
                
        except Exception as e:
            return {"success": False, "username": username, "status": "Error"}
        
        return {"success": False, "username": username, "status": "Error"}
    
    def check_all(self, usernames: List[str]) -> List[Dict[str, Any]]:
        results = []
        for username in usernames:
            result = self.check_one(username)
            results.append(result)
        return results

if __name__ == "__main__":
    usernames = read_usernames()
    if not usernames:
        print(json.dumps([]))
        sys.exit(0)
    
    checker = InstagramBulkChecker()
    results = checker.check_all(usernames)
    print(json.dumps(results, indent=2))