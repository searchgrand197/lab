from lab.db import set_use_demo_db


class DemoDatabaseMiddleware:
    """Send /demo-api/ traffic to the isolated demo SQLite database."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        path = request.path or ''
        is_demo = path.startswith('/demo-api/')
        request.is_demo_api = is_demo
        set_use_demo_db(is_demo)
        try:
            return self.get_response(request)
        finally:
            set_use_demo_db(False)
