import os
import pytest

BUILDER_URL = os.environ.get("BUILDER_URL", "http://localhost:8080")
WORKFLOW_URL = os.environ.get("WORKFLOW_URL", "http://localhost:8082")
