from setuptools import setup, find_packages

setup(
    name="agentscope-skills",
    version="0.1.0",
    description="Upstream capability layer for Atom Agent Platform (hosted in-repo until upstream publishes)",
    packages=find_packages(),
    install_requires=["httpx>=0.27"],
    python_requires=">=3.10",
)
