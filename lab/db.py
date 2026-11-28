"""Thread-local demo database switch for /demo-api/ requests."""

from __future__ import annotations

import threading
from contextlib import contextmanager

_state = threading.local()


def use_demo_db() -> bool:
    return bool(getattr(_state, 'demo', False))


def set_use_demo_db(enabled: bool) -> None:
    _state.demo = bool(enabled)


@contextmanager
def demo_db():
    """Force lab models onto the demo database (seed / maintenance)."""
    previous = use_demo_db()
    set_use_demo_db(True)
    try:
        yield
    finally:
        set_use_demo_db(previous)


class DemoRouter:
    """
    Route lab app models to `demo` while a demo-api request (or seed) is active.
    DemoLead and Django system apps always stay on `default`.
    """

    demo_app_label = 'lab'
    always_default = {
        'DemoLead',
    }
    system_apps = {
        'admin',
        'auth',
        'contenttypes',
        'sessions',
        'messages',
        'staticfiles',
        'corsheaders',
        'accounts',
    }

    def _demo(self, model):
        if model._meta.app_label in self.system_apps:
            return False
        if model._meta.app_label != self.demo_app_label:
            return False
        if model.__name__ in self.always_default:
            return False
        return use_demo_db()

    def db_for_read(self, model, **hints):
        return 'demo' if self._demo(model) else 'default'

    def db_for_write(self, model, **hints):
        return 'demo' if self._demo(model) else 'default'

    def allow_relation(self, obj1, obj2, **hints):
        # Allow relations within the same DB; DemoLead never FKs to demo rows.
        return True

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if app_label in self.system_apps:
            return db == 'default'
        if app_label != self.demo_app_label:
            return db == 'default'
        if (model_name or '').lower() == 'demolead':
            return db == 'default'
        # Lab models (except DemoLead) migrate on both databases.
        # When model_name is omitted, still allow demo so catalog tables are created.
        if db == 'demo':
            return (model_name or '').lower() != 'demolead'
        return db == 'default'
