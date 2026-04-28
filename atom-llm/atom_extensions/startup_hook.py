"""
atom_extensions/startup_hook.py

LiteLLM worker startup hook — registers the KafkaAuditLogger callback.

Configure via env var:
    LITELLM_WORKER_STARTUP_HOOKS=atom_extensions.startup_hook.register_callbacks
"""

import logging

logger = logging.getLogger(__name__)


def register_callbacks() -> None:
    """Register all ATOM audit callbacks with LiteLLM."""
    import litellm
    from atom_extensions.kafka_audit import KafkaAuditLogger

    kafka_logger = KafkaAuditLogger()
    litellm.callbacks.append(kafka_logger)
    logger.info("ATOM: KafkaAuditLogger registered")
