"""Regression: a viewing-app mismatch must not reject a valid Page credential."""
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from worker.token_upkeep import _check_via_app_token, _MetaError


class Response:
    def __init__(self, body):
        self._body = body
        self.ok = 'error' not in body
        self.status_code = 200 if self.ok else 400

    def json(self):
        return self._body


class InspectorTests(unittest.TestCase):
    def test_mismatch_retries_with_saved_token_and_clears_warning(self):
        calls = []
        def get(url, params, timeout):
            calls.append(params['access_token'])
            if len(calls) == 1:
                return Response({'error': {'code': 100, 'message': 'The App_id in the input_token did not match the Viewing App.'}})
            return Response({'data': {'is_valid': True, 'expires_at': 0}})
        result = _check_via_app_token(SimpleNamespace(get=get),
            SimpleNamespace(meta_app_id='new-app', meta_app_secret='secret', graph_version='v25.0'),
            {'platform': 'facebook', 'access_token': 'page-token'}, datetime.now(timezone.utc))
        self.assertEqual(calls, ['new-app|secret', 'page-token'])
        self.assertIsNone(result['token_error'])
        self.assertIsNone(result['token_expires_at'])

    def test_other_meta_errors_are_not_hidden(self):
        def get(url, params, timeout):
            return Response({'error': {'code': 190, 'message': 'Token revoked'}})
        with self.assertRaises(_MetaError):
            _check_via_app_token(SimpleNamespace(get=get),
                SimpleNamespace(meta_app_id='app', meta_app_secret='secret', graph_version='v25.0'),
                {'platform': 'facebook', 'access_token': 'page-token'}, datetime.now(timezone.utc))
