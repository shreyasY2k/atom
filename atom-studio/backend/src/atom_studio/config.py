from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    redis_url: str
    jwt_private_key_path: str
    jwt_public_key_path: str
    atom_encryption_key: str
    atom_llm_url: str = "http://atom-llm:4000"
    atom_runtime_url: str = "http://atom-runtime:8090"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7
    kafka_brokers: str = ""
    platform_hmac_secret: str = ""

    @property
    def jwt_private_key(self) -> str:
        return Path(self.jwt_private_key_path).read_text()

    @property
    def jwt_public_key(self) -> str:
        return Path(self.jwt_public_key_path).read_text()


@lru_cache
def get_settings() -> Settings:
    return Settings()
