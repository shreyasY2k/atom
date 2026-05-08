from setuptools import setup, find_packages

setup(
    name="atom-agent-platform-cli",
    version="0.1.0",
    py_modules=["mphasis"],
    install_requires=["click>=8.1", "pyyaml>=6.0"],
    entry_points={"console_scripts": ["atom=mphasis:cli"]},
)
