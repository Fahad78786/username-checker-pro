#!/usr/bin/env python
# -*- coding: utf-8 -*-

import requests
import json
import sys
import random
from typing import Dict, Any

class InstagramChecker:
    def __init__(self):
        self._samsung_ua = "Instagram 361.0.0.0.84 Android (28/9; 480dpi; 1080x1920; samsung; SM-G930F; herolte; samsungexynos8890; en_US; 673256705)"
        self._desktop_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
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
    
    def check_username(self, username: str) -> Dict[str, Any]:
        """Check Instagram username using all 3 methods"""
        
        methods = [
            self._method_web_api,
            self._method_mobile_api,
            self._method_direct_profile
        ]
        
        for method in methods:
            try:
                result = method(username)
                if result.get('success'):
                    return result
            except:
                continue
        
        return {"success": False, "status": "Not Found"}
    
    def _method_web_api(self, username: str) -> Dict[str, Any]:
        """Method 1: Web API"""
        headers = {
            "User-Agent": self._samsung_ua,
            "Accept": "*/*",
            "Accept-Language": "en-US",
        }
        
        response = requests.get(
            f"https://www.instagram.com/{username}/?__a=1&__d=dis",
            headers=headers,
            proxies=self._get_proxy(),
            timeout=self._timeout
        )
        
        if response.status_code == 200:
            try:
                data = response.json()
                user = data.get('graphql', {}).get('user', {})
                if user:
                    return {
                        "success": True,
                        "username": user.get('username', username),
                        "full_name": user.get('full_name', ''),
                        "followers": user.get('edge_followed_by', {}).get('count', 0),
                        "following": user.get('edge_follow', {}).get('count', 0),
                        "is_private": user.get('is_private', False),
                        "is_verified": user.get('is_verified', False),
                        "profile_pic": user.get('profile_pic_url_hd', ''),
                        "method": "Web API"
                    }
            except:
                pass
        
        if response.status_code == 404:
            return {"success": False, "status": "Not Found"}
        
        return {"success": False, "status": "Error"}
    
    def _method_mobile_api(self, username: str) -> Dict[str, Any]:
        """Method 2: Mobile API"""
        headers = {
            "User-Agent": self._samsung_ua,
            "X-IG-App-ID": "936619743392459",
            "Accept": "*/*",
        }
        
        response = requests.get(
            f"https://i.instagram.com/api/v1/users/web_profile_info/?username={username}",
            headers=headers,
            proxies=self._get_proxy(),
            timeout=self._timeout
        )
        
        if response.status_code == 200:
            try:
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
                        "is_verified": user.get('is_verified', False),
                        "profile_pic": user.get('profile_pic_url_hd', ''),
                        "method": "Mobile API"
                    }
            except:
                pass
        
        if response.status_code == 404:
            return {"success": False, "status": "Not Found"}
        
        return {"success": False, "status": "Error"}
    
    def _method_direct_profile(self, username: str) -> Dict[str, Any]:
        """Method 3: Direct Profile"""
        headers = {
            "User-Agent": self._desktop_ua,
            "Accept": "text/html",
        }
        
        response = requests.get(
            f"https://www.instagram.com/{username}/",
            headers=headers,
            proxies=self._get_proxy(),
            timeout=self._timeout
        )
        
        if response.status_code == 200:
            html = response.text
            if "profile_pic_url" in html or "profile picture" in html.lower():
                return {
                    "success": True,
                    "username": username,
                    "full_name": "Unknown",
                    "followers": 0,
                    "following": 0,
                    "is_private": False,
                    "is_verified": False,
                    "profile_pic": "",
                    "method": "Direct Profile"
                }
        
        if response.status_code == 404 or "sorry, this page isn't available" in response.text.lower():
            return {"success": False, "status": "Not Found"}
        
        return {"success": False, "status": "Error"}

# ✅ Main
if __name__ == "__main__":
    username = sys.argv[1] if len(sys.argv) > 1 else input("Username: ")
    checker = InstagramChecker()
    result = checker.check_username(username)
    print(json.dumps(result, indent=2))