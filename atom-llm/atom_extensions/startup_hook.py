"""
atom_extensions/startup_hook.py

LiteLLM worker startup hook — registers the KafkaAuditLogger and OTELLogger.

LiteLLM expects module:function format (colon, not dot):
    LITELLM_WORKER_STARTUP_HOOKS=atom_extensions.startup_hook:register_callbacks
"""

import logging

logger = logging.getLogger(__name__)


def register_callbacks() -> None:
    """Register all ATOM audit and tracing callbacks with LiteLLM."""
    import os
    import litellm

    if os.environ.get("KAFKA_BROKERS"):
        from atom_extensions.kafka_audit import KafkaAuditLogger

        litellm.callbacks.append(KafkaAuditLogger())
        logger.info("ATOM: KafkaAuditLogger registered")

    if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        from atom_extensions.otel import OTELLogger

        litellm.callbacks.append(OTELLogger())
        logger.info("ATOM: OTELLogger registered")
