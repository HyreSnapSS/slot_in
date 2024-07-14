import uuid
from flask import request, session
from firebase_admin import auth
from glom import glom
from config import API_KEY


class Response:
    def __init__(self, status: int, data) -> None:
        self.status = status
        self.data = data
    
    def success(self):
        return {
            "requestId":str(uuid.uuid4()),
            "status": self.status,
            "data": self.data,
            "success": True
        }
    
    def error(self):
        return {
            "requestId":str(uuid.uuid4()),
            "status": self.status,
            "error": self.data,
            "success": False
        }
    
    def before_request():
        if 'x-api-key' not in request.headers:
            raise ValueError('Api key is missing!')
        else:
            api_key = request.headers.get('x-api-key')
            if api_key != API_KEY:
                raise ValueError('Api key is not correct!')
        if 'Authorization' not in request.headers:
            raise ValueError("Unauthorized access!")
        token = request.headers.get('Authorization').split('Bearer ')[1]
        decoded_token = auth.verify_id_token(token)
        user_detail_keys={
            'name': 'name',
            'email': 'email',
            'provider': 'firebase.sign_in_provider',
            "picture": "picture", 
            "user_id": "user_id"
        }
        user_details = {key: glom(decoded_token, path) for key, path in user_detail_keys.items()}
        session['user'] = user_details
